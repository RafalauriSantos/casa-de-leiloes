import type { LotInput, OwnLot } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import { cancelLot, fetchOwnLots, updateLot } from '../api';
import { formatWhen, STATE_LABEL } from '../time';
import { LotForm, valuesOf } from './LotForm';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lots: OwnLot[] };

export function OwnLots({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [editing, setEditing] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchOwnLots(token)
      .then((lots) => { if (!cancelled) setLoad({ status: 'ready', lots }); })
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
    try {
      await cancelLot(token, lot.id);
      setNotice(`Lote "${lot.title}" cancelado.`);
      reload();
    } catch (error: unknown) {
      fail(error);
    }
  }

  return (
    <section aria-labelledby="lots-title">
      <h2 id="lots-title">3. Meus lotes</h2>
      {notice && <p role="status">{notice}</p>}
      {load.status === 'loading' && <p>Carregando seus lotes…</p>}
      {load.status === 'error' && (
        <>
          <p role="alert">{load.message}</p>
          <button type="button" onClick={reload}>Tentar de novo</button>
        </>
      )}
      {load.status === 'ready' && load.lots.length === 0 && <p>Você ainda não publicou lotes.</p>}
      {load.status === 'ready' && load.lots.map((lot) => (
        <article key={lot.id} className="own-lot">
          <h3>{lot.title}</h3>
          <p>
            <span className="state">{STATE_LABEL[lot.state]}</span> · lance inicial {formatBRL(lot.startingBidCents)} · incremento {formatBRL(lot.incrementCents)}
          </p>
          <p><small>De {formatWhen(lot.startsAt)} até {formatWhen(lot.endsAt)} · {lot.bidCount} lance(s)</small></p>
          {lot.canEdit && editing !== lot.id && (
            <button type="button" onClick={() => { setEditing(lot.id); }}>Editar</button>
          )}
          {lot.canCancel && <button type="button" onClick={() => void cancel(lot)}>Cancelar lote</button>}
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
