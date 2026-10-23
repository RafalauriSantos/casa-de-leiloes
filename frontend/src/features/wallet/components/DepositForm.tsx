import { DEPOSIT_MAX_CENTS, DEPOSIT_MIN_CENTS, type WalletResponse } from '@casa/contracts';
import { useRef, useState, type SyntheticEvent } from 'react';
import { formatBRL, parseReaisToCents } from '@/lib/format';
import { postDeposit } from '../api';

interface Props {
  token: string;
  onDeposited: (wallet: WalletResponse) => void;
}

const LIMITS = `${formatBRL(DEPOSIT_MIN_CENTS)} a ${formatBRL(DEPOSIT_MAX_CENTS)}`;

export function DepositForm({ token, onDeposited }: Props) {
  // One key per deposit intent: kept on failure (a retry cannot credit twice), renewed on success.
  const key = useRef(crypto.randomUUID());
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('amount');
    const cents = parseReaisToCents(typeof raw === 'string' ? raw : '');
    setNotice(undefined);

    if (cents === undefined) {
      setError('Informe um valor válido, por exemplo 250,00.');
      return;
    }
    if (cents < DEPOSIT_MIN_CENTS || cents > DEPOSIT_MAX_CENTS) {
      setError(`O depósito deve ser de ${LIMITS}.`);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const wallet = await postDeposit(token, cents, key.current);
      key.current = crypto.randomUUID();
      form.reset();
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
      <h2 id="deposit-title">Depositar saldo (simulado)</h2>
      <label>
        Valor (R$)
        <input name="amount" inputMode="decimal" autoComplete="off" placeholder="250,00" required />
      </label>
      <small>Depósito simulado, de {LIMITS} por vez. Nenhum pagamento real é feito.</small>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Depositando…' : 'Depositar'}</button>
    </form>
  );
}
