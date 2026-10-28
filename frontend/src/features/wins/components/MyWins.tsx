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

function noteFor(outcome: MyLotOutcome, bestCents: number): string {
  if (outcome === 'won') return `Você arrematou por ${formatBRL(bestCents)}`;
  if (outcome === 'lost') return `Seu maior lance foi ${formatBRL(bestCents)} · o valor voltou para o saldo`;
  return `Seu maior lance foi ${formatBRL(bestCents)}`;
}

/** The lots in the order the bidder cares about: what is still open, what was won, what was not. */
const GROUPS: Array<{ title: string; outcomes: MyLotOutcome[] }> = [
  { title: 'Em disputa', outcomes: ['leading', 'outbid', 'settling'] },
  { title: 'Arrematados', outcomes: ['won'] },
  { title: 'Não arrematados', outcomes: ['lost', 'cancelled'] },
];

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
      {state.status === 'ready' && GROUPS.map((group) => {
        const lots = state.lots.filter((lot) => group.outcomes.includes(lot.outcome));
        if (lots.length === 0) return null;
        return (
          <section key={group.title} aria-label={group.title}>
            <h2>{group.title}</h2>
            <ul className="my-lots">
              {lots.map((lot) => (
                <li key={lot.lotId}>
                  <img src={lot.imageUrl} alt="" className="lot-thumb" loading="lazy" />
                  <div className="my-lot-body">
                    {lot.outcome === 'cancelled' ? <strong>{lot.title}</strong> : <Link to={`/lotes/${lot.lotId}`}><strong>{lot.title}</strong></Link>}
                    <span className="my-lot-note"><span className="state">{OUTCOME_LABEL[lot.outcome]}</span> · {noteFor(lot.outcome, lot.myBestCents)}</span>
                  </div>
                  {lot.receiptCode !== null
                    ? <Link className="my-lot-action" to={`/comprovante/${lot.receiptCode}`}>Ver comprovante</Link>
                    : lot.outcome !== 'cancelled' && <Link className="my-lot-action secondary-link" to={`/lotes/${lot.lotId}`}>Ver lote</Link>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
