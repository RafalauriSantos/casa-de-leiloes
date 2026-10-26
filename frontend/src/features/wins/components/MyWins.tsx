import type { MyLot, MyLotOutcome } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { fetchMyLots } from '../api';

const OUTCOME_LABEL: Record<MyLotOutcome, string> = {
  won: 'Arrematado',
  lost: 'Não arrematado',
  leading: 'Você está ganhando',
  settling: 'Encerrado, aguardando o comprovante',
  outbid: 'Superado',
  cancelled: 'Cancelado',
};

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lots: MyLot[] };

export function MyWins({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchMyLots(token)
      .then((lots) => { if (!cancelled) setState({ status: 'ready', lots }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [token, attempt]);

  return (
    <section aria-label="Meus arremates">
      <h1>Meus arremates</h1>
      {state.status === 'loading' && <p>Carregando seus lotes…</p>}
      {state.status === 'error' && (
        <>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={() => { setAttempt((n) => n + 1); }}>Tentar de novo</button>
        </>
      )}
      {state.status === 'ready' && state.lots.length === 0 && (
        <p className="empty">Você ainda não deu lances. Os lotes em que der lance aparecem aqui.</p>
      )}
      {state.status === 'ready' && state.lots.some((lot) => lot.outcome === 'settling') && (
        <p>
          Um lote encerrado ainda não tem comprovante: a liquidação dele pode demorar ou estar em verificação.{' '}
          <button type="button" onClick={() => { setAttempt((n) => n + 1); }}>Atualizar</button>
        </p>
      )}
      {state.status === 'ready' && state.lots.length > 0 && (
        <ul className="my-lots">
          {state.lots.map((lot) => (
            <li key={lot.lotId}>
              {lot.outcome === 'cancelled' ? lot.title : <Link to={`/lotes/${lot.lotId}`}>{lot.title}</Link>}{' '}
              <span className="state">{OUTCOME_LABEL[lot.outcome]}</span> · seu maior lance {formatBRL(lot.myBestCents)}
              {lot.receiptCode !== null && (
                <> · <Link to={`/comprovante/${lot.receiptCode}`}>Ver comprovante</Link></>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
