import type { LotSummary } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { useAuth } from '@/features/auth';
import { fetchLots, type ShowcaseStatus } from '../api';
import { formatWhen } from '../time';
import { LotCard } from './LotCard';

/** Same cadence as the live room: a lot that ends or starts while the page is open changes the dot within this time. */
const LIVE_CHECK_MS = 3_000;

const TABS: Array<{ value: ShowcaseStatus; label: string }> = [
  { value: 'live', label: 'Ao vivo' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'ended', label: 'Encerrados' },
];

const EMPTY_HINT: Record<ShowcaseStatus, string> = {
  live: 'Nenhum lote ao vivo agora. Quando um leiloeiro publicar um lote e o início chegar, ele aparece aqui.',
  scheduled: 'Nenhum lote agendado no momento. Os próximos lotes aparecem nesta aba antes de começar.',
  ended: 'Ainda não há lotes encerrados.',
};

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lots: LotSummary[] };

export function Showcase() {
  const auth = useAuth();
  const isAuctioneer = auth.status === 'signed-in' && auth.me.role === 'auctioneer';
  const [tab, setTab] = useState<ShowcaseStatus>('live');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  /** Whether a lot is open right now. Unknown or failed reads count as none: the tab never claims a live lot it has not seen. */
  const [hasLive, setHasLive] = useState(false);
  /** The first lot open right now, shown as the featured lot of the showcase. */
  const [liveLot, setLiveLot] = useState<LotSummary>();

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

  useEffect(() => {
    let cancelled = false;
    // Only the newest answer counts: an older response that arrives late cannot overwrite a newer one.
    let latest = 0;
    const check = () => {
      const request = ++latest;
      fetchLots({ status: 'live' })
        .then((lots) => {
          if (!cancelled && request === latest) {
            setHasLive(lots.length > 0);
            setLiveLot(lots[0]);
          }
        })
        .catch(() => {
          if (!cancelled && request === latest) {
            setHasLive(false);
            setLiveLot(undefined);
          }
        });
    };
    check();
    const timer = setInterval(check, LIVE_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [attempt]);

  return (
    <section aria-label="Vitrine">
      <div className="showcase-hero">
        <h1>Leilões ao vivo</h1>
        <form onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }} role="search">
          <label>
            Buscar por título
            <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="Relógio, mapa, Sèvres" />
          </label>
          <button type="submit">Buscar</button>
        </form>
      </div>
      {liveLot && (
        <section className="featured" aria-label="Lote ao vivo em destaque">
          <img src={liveLot.imageUrl} alt="" />
          <div className="featured-body">
            <span className="featured-status">Ao vivo agora</span>
            <p className="featured-title">{liveLot.title}</p>
            <div className="featured-stats">
              <div><span>Lance atual</span><strong>{formatBRL(liveLot.currentAmountCents ?? liveLot.startingBidCents)}</strong></div>
              <div><span>Termina em</span><strong>{formatWhen(liveLot.endsAt)}</strong></div>
            </div>
            <div className="featured-actions">
              <Link className="featured-bid" to={`/lotes/${liveLot.id}`}>{isAuctioneer ? 'Ver lote' : 'Dar lance'}</Link>
              <Link to={`/lotes/${liveLot.id}`}>Histórico</Link>
            </div>
          </div>
        </section>
      )}
      <section className="upcoming" aria-labelledby="upcoming-title">
        <div className="upcoming-head">
          <h2 id="upcoming-title">Próximos leilões</h2>
          <nav aria-label="Estado dos lotes">
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={item.value === 'live' && hasLive ? 'tab-live' : undefined}
                aria-pressed={tab === item.value}
                onClick={() => { setTab(item.value); }}
              >
                {item.value === 'live' && hasLive && <span className="live-dot" aria-hidden="true" />}
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        {state.status === 'loading' && <p>Carregando lotes…</p>}
        {state.status === 'error' && (
          <>
            <p role="alert">{state.message}</p>
            <button type="button" onClick={() => { setAttempt((n) => n + 1); }}>Tentar de novo</button>
          </>
        )}
        {state.status === 'ready' && state.lots.length === 0 && (
          <div className="empty">
            <p>{query ? `Nenhum lote encontrado para "${query}".` : EMPTY_HINT[tab]}</p>
            {isAuctioneer && <Link className="my-lot-action" to="/leiloeiro/novo">Criar lote</Link>}
            {!isAuctioneer && tab !== 'scheduled' && (
              <button type="button" onClick={() => { setTab('scheduled'); }}>Ver agendados</button>
            )}
          </div>
        )}
        {state.status === 'ready' && state.lots.length > 0 && (
          <div className="lot-rows">
            {state.lots.map((lot) => <LotCard key={lot.id} lot={lot} />)}
          </div>
        )}
      </section>
    </section>
  );
}
