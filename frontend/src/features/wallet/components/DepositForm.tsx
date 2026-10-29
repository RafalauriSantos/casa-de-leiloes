import { DEPOSIT_MAX_CENTS, DEPOSIT_MIN_CENTS, type WalletResponse } from '@casa/contracts';
import { useRef, useState, type SyntheticEvent } from 'react';
import { formatBRL, parseReaisToCents } from '@/lib/format';
import { intentFor, type Intent } from '@/lib/idempotency';
import { postDeposit } from '../api';

interface Props {
  token: string;
  onDeposited: (wallet: WalletResponse) => void;
}

const QUICK_AMOUNTS = [100, 250, 500];
const LIMITS = `${formatBRL(DEPOSIT_MIN_CENTS)} a ${formatBRL(DEPOSIT_MAX_CENTS)}`;

export function DepositForm({ token, onDeposited }: Props) {
  // One key per deposit intent: kept on failure (a retry cannot credit twice), dropped on success.
  const intent = useRef<Intent>(undefined);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseReaisToCents(amount);
    setNotice(undefined);

    if (cents === undefined) {
      setError('Informe um valor válido, por exemplo 250,00.');
      return;
    }
    if (cents < DEPOSIT_MIN_CENTS || cents > DEPOSIT_MAX_CENTS) {
      setError(`O depósito deve ser de ${LIMITS}.`);
      return;
    }

    intent.current = intentFor(intent.current, cents);
    setBusy(true);
    setError(undefined);
    try {
      const wallet = await postDeposit(token, cents, intent.current.key);
      intent.current = undefined;
      setAmount('');
      setNotice(`Depósito de ${formatBRL(cents)} realizado.`);
      onDeposited(wallet);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Não foi possível depositar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} aria-labelledby="deposit-title">
      <h2 id="deposit-title">Depositar</h2>
      <label>
        Valor (R$)
        <input name="amount" value={amount} onChange={(e) => { setAmount(e.target.value); }} inputMode="decimal" autoComplete="off" placeholder="250,00" required />
      </label>
      <div role="group" aria-label="Valores rápidos" className="chips">
        {QUICK_AMOUNTS.map((cents) => (
          <button key={cents} type="button" className="chip" onClick={() => { setAmount(`${String(cents)},00`); }}>
            R$ {String(cents)}
          </button>
        ))}
      </div>
      <small>Depósito simulado, de {LIMITS} por vez. Nenhum pagamento real é feito.</small>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Depositando…' : 'Depositar'}</button>
    </form>
  );
}
