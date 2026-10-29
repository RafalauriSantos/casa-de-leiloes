import { BID_LIMIT_MESSAGE, MAX_BIDS_PER_LOT, type BidReceipt, type ErrorCode, type LiveLot } from '@casa/contracts';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL, formatReaisInput, parseReaisToCents } from '@/lib/format';
import { useAuth } from '@/features/auth';
import { fetchWallet } from '@/features/wallet';
import { fetchLive, placeBid } from '../api';
import { addReceipt, readReceipts } from '../receipts';
import { clockOffset, formatRemaining, formatWhen, remainingMs, STATE_LABEL } from '../time';

const POLL_MS = 3_000;

/** Why a lot takes no bid yet or any more, in the words the server uses for the same refusals (bidding rules). A cancelled lot has no room: the public read hides it (D17). */
const NOT_LIVE_MESSAGE: Partial<Record<LiveLot['state'], string>> = {
  scheduled: 'O lote ainda não começou.',
  ended: 'Este lote já encerrou.',
};

/** The bid button names the amount it will place, as the canvas does; without a valid amount it stays plain. */
function bidButtonLabel(amount: string): string {
  const cents = parseReaisToCents(amount);
  return cents === undefined ? 'Dar lance' : `Dar lance de ${formatBRL(cents)}`;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; room: LiveLot };

export function LiveRoom({ lotId }: { lotId: string }) {
  const auth = useAuth();
  const token = auth.status === 'signed-in' ? auth.token : undefined;
  const role = auth.status === 'signed-in' ? auth.me.role : undefined;
  const userId = auth.status === 'signed-in' ? auth.me.id : undefined;

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [bidError, setBidError] = useState<{ message: string; code?: ErrorCode }>();
  /** The bidder's available balance, shown under the bid form (the canvas's "Disponível para lances"). */
  const [available, setAvailable] = useState<number>();
  // The receipts belong to the user named in `owner`, so another user never sees them, not even for one render.
  const [stored, setStored] = useState<{ owner: string | undefined; list: BidReceipt[] }>({ owner: undefined, list: [] });
  const receipts = stored.owner === userId ? stored.list : [];
  const signedInUser = useRef(userId);
  signedInUser.current = userId;
  /** Whether the bidder has typed a custom value in the bid field; while false, polls follow `nextMinimumCents`. */
  const edited = useRef(false);
  useEffect(() => {
    setStored({ owner: userId, list: userId ? readReceipts(userId, lotId) : [] });
  }, [userId, lotId]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Every read takes a number; only an answer newer than the last applied one may replace the screen.
  // A bid moves the applied number past every read started before it, so no older poll can undo it.
  const readCount = useRef(0);
  const applied = useRef(0);

  // Poll the room every 3 s, pause while the tab is hidden, and show when the connection is failing.
  useEffect(() => {
    // Refs, not plain variables: the callbacks below read them after awaits.
    const alive = { current: true };
    const inFlight = { current: false };
    const read = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const mine = ++readCount.current;
      const sentAt = Date.now();
      try {
        const room = await fetchLive(lotId, token);
        inFlight.current = false;
        if (!alive.current) return;
        setOffset(clockOffset(room.serverNow, sentAt, Date.now()));
        // An answer to an older request must not overwrite a newer one.
        if (mine > applied.current) {
          applied.current = mine;
          setLoad({ status: 'ready', room });
          if (!edited.current) setAmount(formatReaisInput(room.nextMinimumCents));
        }
        setStale(false);
      } catch (error: unknown) {
        inFlight.current = false;
        if (!alive.current) return;
        setStale(true);
        setLoad((current) => (current.status === 'ready' ? current : { status: 'error', message: error instanceof ApiRequestError ? error.message : 'Não foi possível carregar a sala.' }));
      }
      // Unmounted reads already returned above, so only the tab's visibility is left to check here.
      if (document.visibilityState === 'visible') timer.current = setTimeout(() => void read(), POLL_MS);
    };
    const onVisible = () => {
      clearTimeout(timer.current);
      if (document.visibilityState === 'visible') void read();
    };
    void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [lotId, token]);

  // The available balance, read when the bidder opens the room and again after each accepted bid.
  useEffect(() => {
    if (!token || role !== 'bidder') return;
    let cancelled = false;
    fetchWallet(token)
      .then((wallet) => { if (!cancelled) setAvailable(wallet.availableCents); })
      .catch(() => { if (!cancelled) setAvailable(undefined); });
    return () => { cancelled = true; };
  }, [token, role, load.status === 'ready' ? load.room.bidCount : 0]);

  // Re-render every second so the countdown moves.
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
  }, []);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !userId) return;
    const cents = parseReaisToCents(amount);
    if (cents === undefined) {
      setBidError({ message: 'Informe o lance em reais, por exemplo 550,00.' });
      return;
    }
    setBusy(true);
    setBidError(undefined);
    try {
      const accepted = await placeBid(token, lotId, cents);
      // The receipt is saved even if the signed-in user changed while the bid was in flight: the server accepted it.
      const next = addReceipt(userId, lotId, accepted.receipt, receipts);
      if (signedInUser.current === userId) setStored({ owner: userId, list: next });
      // Polls started before this answer are now stale: drop them so they cannot undo it.
      if (signedInUser.current === userId) {
        readCount.current++;
        applied.current = readCount.current;
        edited.current = false;
        setLoad({ status: 'ready', room: accepted });
        setAmount(formatReaisInput(accepted.nextMinimumCents));
      }
    } catch (error: unknown) {
      setBidError(
        error instanceof ApiRequestError
          ? { message: error.message, code: error.code }
          : { message: 'Não foi possível registrar o lance.' },
      );
    } finally {
      setBusy(false);
    }
  }

  if (load.status === 'loading') return <p>Carregando a sala…</p>;
  if (load.status === 'error') return <p role="alert">{load.message}</p>;
  const { room } = load;
  const remaining = remainingMs(room.endsAt, offset, now);
  const full = room.bidCount >= MAX_BIDS_PER_LOT;
  const canBid = room.state === 'live' && role === 'bidder' && !full;

  return (
    <section aria-label="Sala do lote">
      <h2>Sala ao vivo</h2>
      <p className="room-status">
        <span className="state">{STATE_LABEL[room.state]}</span>
        {room.state === 'live' && <span className="room-refresh">Atualiza a cada 3 s</span>}
      </p>
      {NOT_LIVE_MESSAGE[room.state] && <p>{NOT_LIVE_MESSAGE[room.state]}</p>}
      {room.state === 'live' && remaining > 0 && (
        <div className="countdown">
          <span className="label">Termina em</span>
          <span className="countdown-time">{formatRemaining(remaining)}</span>
        </div>
      )}
      {room.state === 'live' && remaining <= 0 && <p><strong>Encerrando…</strong></p>}
      {room.state === 'scheduled' && <p>Começa em {formatWhen(room.startsAt)}</p>}
      {room.state === 'ended' && <p>Encerrado em {formatWhen(room.endsAt)}</p>}
      {stale && <p role="status">Conexão instável: a tela pode estar atrasada. Tentando de novo…</p>}

      <dl>
        <div><dt>Lance atual</dt><dd>{room.currentAmountCents === null ? 'nenhum' : formatBRL(room.currentAmountCents)}</dd></div>
        <div><dt>Mínimo para dar lance</dt><dd>{formatBRL(room.nextMinimumCents)}</dd></div>
        <div><dt>Lances</dt><dd>{room.bidCount}</dd></div>
      </dl>

      {room.position === 'leading' && room.state === 'live' && (
        <p role="status" className="position leading">
          <strong>Você está ganhando.</strong>
          <span>Seu lance lidera e esse valor fica reservado na carteira.</span>
        </p>
      )}
      {room.position === 'leading' && room.state === 'ended' && (
        <p role="status" className="position leading">
          <strong>Você arrematou este lote.</strong>
          <span>O resultado está em <Link to="/arremates">Meus arremates</Link>.</span>
        </p>
      )}
      {room.position === 'outbid' && (
        <p role="alert" className="position outbid">
          <strong>Você foi superado.</strong>
          <span>Dê um novo lance para voltar à frente.</span>
        </p>
      )}

      {canBid && (
        <form onSubmit={(event) => void submit(event)} aria-label="Dar lance">
          <div className="bid-head">
            <label htmlFor="bid-amount">Seu lance (R$)</label>
            <button
              type="button"
              className="link"
              onClick={() => {
                edited.current = false;
                setAmount(formatReaisInput(room.nextMinimumCents));
                setBidError(undefined);
              }}
            >
              Usar lance mínimo
            </button>
          </div>
          <input
            id="bid-amount"
            value={amount}
            onChange={(event) => {
              edited.current = true;
              setAmount(event.target.value);
              setBidError(undefined);
            }}
            inputMode="decimal"
            required
          />
          {bidError && <p role="alert">{bidError.message}</p>}
          {bidError?.code === 'insufficient_funds' && (
            <p><Link to="/carteira">Depositar na carteira</Link></p>
          )}
          <button type="submit" disabled={busy || remaining <= 0}>
            {busy ? 'Enviando…' : bidButtonLabel(amount)}
          </button>
          {available !== undefined && (
            <p className="room-available">Disponível para lances: <strong>{formatBRL(available)}</strong></p>
          )}
        </form>
      )}
      {room.state === 'live' && full && <p>{BID_LIMIT_MESSAGE}</p>}
      {receipts.length > 0 && (
        <section aria-label="Seus recibos">
          <h3>Seus recibos</h3>
          <p>Guarde a ponta: ela comprova o seu lance na auditoria.</p>
          <ul>
            {receipts.map((receipt) => (
              <li key={receipt.seq}>
                Lance nº {receipt.seq}: <code className="audit-hash">{receipt.head}</code>{' '}
                <Link to={`/auditoria/${lotId}?head=${receipt.head}`}>Conferir na auditoria</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {room.state === 'live' && role === undefined && <p>Entre como licitante para dar lances.</p>}
      {role === 'auctioneer' && <p>Leiloeiros não dão lances.</p>}

      <h3>Histórico</h3>
      {room.history.length === 0 ? (
        <p>Nenhum lance ainda.</p>
      ) : (
        <ol className="history">
          {room.history.map((entry) => (
            <li key={entry.seq} className={entry.mine ? 'mine' : undefined}>
              <span className="history-who">{entry.mine ? 'Você' : `Licitante ${entry.bidderLabel.slice(0, 6)}`}</span>
              <strong>{formatBRL(entry.amountCents)}</strong>
              <small>{formatWhen(entry.placedAt)}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
