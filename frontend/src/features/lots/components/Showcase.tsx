import type { LotSummary } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { fetchLots, type ShowcaseStatus } from '../api';
import { LotCard } from './LotCard';

const TABS: Array<{ value: ShowcaseStatus; label: string }> = [
  { value: 'live', label: 'Ao vivo' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'ended', label: 'Encerrados' },
];

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lots: LotSummary[] };

export function Showcase() {
  const [tab, setTab] = useState<ShowcaseStatus>('live');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchLots({ status: tab, q: query || undefined })
      .then((lots) => { if (!cancelled) setState({ status: 'ready', lots }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [tab, query, attempt]);

  return (
    <section aria-label="Vitrine">
      <h1>Lotes</h1>
      <form onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }} role="search">
        <label>
          Buscar por título
          <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="vaso, jarra..." />
        </label>
        <button type="submit">Buscar</button>
      </form>
      <nav aria-label="Estado dos lotes">
        {TABS.map((item) => (
          <button key={item.value} type="button" aria-pressed={tab === item.value} onClick={() => { setTab(item.value); }}>
            {item.label}
          </button>
        ))}
      </nav>
      {state.status === 'loading' && <p>Carregando lotes…</p>}
      {state.status === 'error' && (
        <>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={() => { setAttempt((n) => n + 1); }}>Tentar de novo</button>
        </>
      )}
      {state.status === 'ready' && state.lots.length === 0 && <p>Nenhum lote nesta lista.</p>}
      {state.status === 'ready' && state.lots.length > 0 && (
        <div className="lot-grid">
          {state.lots.map((lot) => <LotCard key={lot.id} lot={lot} />)}
        </div>
      )}
    </section>
  );
}
