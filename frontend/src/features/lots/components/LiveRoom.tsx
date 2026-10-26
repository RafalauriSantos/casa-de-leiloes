import { BID_LIMIT_MESSAGE, MAX_BIDS_PER_LOT, type BidReceipt, type LiveLot } from '@casa/contracts';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL, parseReaisToCents } from '@/lib/format';
import { useAuth } from '@/features/auth';
import { fetchLive, placeBid } from '../api';
import { addReceipt, readReceipts } from '../receipts';
import { clockOffset, formatRemaining, formatWhen, remainingMs, STATE_LABEL } from '../time';

const POLL_MS = 3_000;

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
  const [bidError, setBidError] = useState<string>();
  // The receipts belong to the user named in `owner`, so another user never sees them, not even for one render.
  const [stored, setStored] = useState<{ owner: string | undefined; list: BidReceipt[] }>({ owner: undefined, list: [] });
  const receipts = stored.owner === userId ? stored.list : [];
  const signedInUser = useRef(userId);
  signedInUser.current = userId;
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
        }
        setStale(false);
        setAmount((current) => (current === '' ? (room.nextMinimumCents / 100).toFixed(2).replace('.', ',') : current));
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
      setBidError('Informe o lance em reais, por exemplo 550,00.');
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
        setLoad({ status: 'ready', room: accepted });
        setAmount((accepted.nextMinimumCents / 100).toFixed(2).replace('.', ','));
      }
    } catch (error: unknown) {
      setBidError(error instanceof ApiRequestError ? error.message : 'Não foi possível registrar o lance.');
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
      <p>
        <span className="state">{STATE_LABEL[room.state]}</span>{' '}
        {room.state === 'live' && remaining > 0 && <strong>Termina em {formatRemaining(remaining)}</strong>}
        {room.state === 'live' && remaining <= 0 && <strong>Encerrando…</strong>}
        {room.state === 'scheduled' && <>Começa em {formatWhen(room.startsAt)}</>}
        {room.state === 'ended' && <>Encerrado em {formatWhen(room.endsAt)}</>}
      </p>
      {stale && <p role="status">Conexão instável: a tela pode estar atrasada. Tentando de novo…</p>}

      <dl>
        <div><dt>Lance atual</dt><dd>{room.currentAmountCents === null ? 'nenhum' : formatBRL(room.currentAmountCents)}</dd></div>
        <div><dt>Próximo lance mínimo</dt><dd>{formatBRL(room.nextMinimumCents)}</dd></div>
        <div><dt>Lances</dt><dd>{room.bidCount}</dd></div>
      </dl>

      {room.position === 'leading' && <p role="status" className="position leading">Você está ganhando.</p>}
      {room.position === 'outbid' && <p role="alert" className="position outbid">Você foi superado.</p>}

      {canBid && (
        <form onSubmit={(event) => void submit(event)} aria-label="Dar lance">
          <label>
            Seu lance (R$)
            <input value={amount} onChange={(event) => { setAmount(event.target.value); }} inputMode="decimal" required />
          </label>
          {bidError && <p role="alert">{bidError}</p>}
          <button type="submit" disabled={busy || remaining <= 0}>{busy ? 'Enviando…' : 'Dar lance'}</button>
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
            <li key={entry.seq}>
              <span>{entry.mine ? 'Você' : `Licitante ${entry.bidderLabel.slice(0, 6)}`}</span>{' '}
              <strong>{formatBRL(entry.amountCents)}</strong> <small>{formatWhen(entry.placedAt)}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
