import type { AuctioneerSummary, LotInput, OwnLot } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import { cancelLot, fetchAuctioneerSummary, fetchOwnLots, updateLot } from '../api';
import { formatWhen, STATE_LABEL } from '../time';
import { LotForm, valuesOf } from './LotForm';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lots: OwnLot[]; summary: AuctioneerSummary };

/** The line under an ended lot: what it sold for, or that nobody bid, or that its settlement is still pending. */
function resultText(lot: OwnLot): string | undefined {
  if (!lot.result) return undefined;
  if (lot.result.outcome === 'sold') return `Arrematado por ${formatBRL(lot.result.amountCents ?? 0)}`;
  if (lot.result.outcome === 'no_bids') return 'Encerrado sem lances';
  return 'Encerrado · aguardando liquidação';
}

export function OwnLots({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [editing, setEditing] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  /** The lot with bids whose cancellation waits for a second click: it refunds the leader (B19). */
  const [confirming, setConfirming] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOwnLots(token), fetchAuctioneerSummary(token)])
      .then(([lots, summary]) => { if (!cancelled) setLoad({ status: 'ready', lots, summary }); })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [token, attempt]);

  const reload = () => {
    setAttempt((n) => n + 1);
  };
  const fail = (error: unknown) => {
    setNotice(error instanceof ApiRequestError ? error.message : 'Não foi possível concluir a ação.');
  };

  async function cancel(lot: OwnLot) {
    setConfirming(undefined);
    try {
      await cancelLot(token, lot.id);
      setNotice(lot.bidCount > 0 ? `Lote "${lot.title}" cancelado. O valor do lance líder voltou para o licitante.` : `Lote "${lot.title}" cancelado.`);
      reload();
    } catch (error: unknown) {
      fail(error);
    }
  }

  return (
    <section aria-labelledby="lots-title">
      <h2 id="lots-title">Meus lotes</h2>
      {notice && <p role="status">{notice}</p>}
      {load.status === 'loading' && <p>Carregando seus lotes…</p>}
      {load.status === 'error' && (
        <>
          <p role="alert">{load.message}</p>
          <button type="button" onClick={reload}>Tentar de novo</button>
        </>
      )}
      {load.status === 'ready' && load.lots.length === 0 && <p>Você ainda não publicou lotes.</p>}
      {load.status === 'ready' && load.lots.length > 0 && (
        <p>
          Total recebido: {formatBRL(load.summary.totalReceivedCents)} · {load.summary.soldLots} de {load.summary.endedLots} lote(s) encerrado(s) vendido(s)
        </p>
      )}
      {load.status === 'ready' && load.lots.map((lot) => (
        <article key={lot.id} className="own-lot">
          <h3>{lot.title}</h3>
          <p>
            <span className="state">{STATE_LABEL[lot.state]}</span> · lance inicial {formatBRL(lot.startingBidCents)} · incremento {formatBRL(lot.incrementCents)}
          </p>
          <p><small>De {formatWhen(lot.startsAt)} até {formatWhen(lot.endsAt)} · {lot.bidCount} lance(s)</small></p>
          {resultText(lot) && <p><strong>{resultText(lot)}</strong></p>}
          <div className="own-lot-actions">
            {lot.canEdit && editing !== lot.id && (
              <button type="button" onClick={() => { setEditing(lot.id); }}>Editar</button>
            )}
            {lot.canCancel && confirming !== lot.id && (
              <button type="button" className="secondary" onClick={() => { setConfirming(lot.id); }}>Cancelar lote</button>
            )}
          </div>
          {confirming === lot.id && (
            <div>
              {lot.bidCount > 0
                ? <p>Este lote tem lances. Cancelar devolve na hora o valor comprometido de quem lidera, e ninguém paga nada.</p>
                : <p>Confirme para cancelar este lote.</p>}
              <button type="button" onClick={() => void cancel(lot)}>Confirmar cancelamento</button>
              <button type="button" onClick={() => { setConfirming(undefined); }}>Manter o lote</button>
            </div>
          )}
          {editing === lot.id && (
            <LotForm
              initial={valuesOf(lot)}
              submitLabel="Salvar alterações"
              onSubmit={(input: LotInput) => updateLot(token, lot.id, input)}
              onDone={() => {
                setEditing(undefined);
                setNotice('Lote atualizado.');
                reload();
              }}
            />
          )}
        </article>
      ))}
    </section>
  );
}
