import type { LotDetail as LotDetailView } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import { fetchLot } from '../api';
import { LiveRoom } from './LiveRoom';
import { formatWhen, STATE_LABEL } from '../time';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lot: LotDetailView };

export function LotDetail({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchLot(id)
      .then((lot) => { if (!cancelled) setState({ status: 'ready', lot }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof ApiRequestError ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [id]);

  if (state.status === 'loading') return <p>Carregando lote…</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  const { lot } = state;
  const attributes = Object.entries(lot.attributes).filter((entry): entry is [string, string] => entry[1] !== null);
  const labels: Record<string, string> = { artist: 'Artista', date: 'Data', medium: 'Técnica', department: 'Departamento', culture: 'Cultura' };

  return (
    <article aria-label="Lote">
      <h1>{lot.title}</h1>
      <LiveRoom lotId={lot.id} />
      <img src={lot.imageUrl} alt={lot.title} className="lot-hero" />
      <p><span className="state">{STATE_LABEL[lot.state]}</span></p>
      <dl>
        <div><dt>Lance inicial</dt><dd>{formatBRL(lot.startingBidCents)}</dd></div>
        <div><dt>Incremento mínimo</dt><dd>{formatBRL(lot.incrementCents)}</dd></div>
        <div><dt>Início</dt><dd>{formatWhen(lot.startsAt)}</dd></div>
        <div><dt>Fim</dt><dd>{formatWhen(lot.endsAt)}</dd></div>
      </dl>
      <h2>Sobre o item</h2>
      <dl>
        {attributes.map(([key, value]) => (
          <div key={key}><dt>{labels[key] ?? key}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p><a href={lot.sourceUrl} target="_blank" rel="noreferrer">Ver a obra na fonte (The Met)</a></p>
    </article>
  );
}
