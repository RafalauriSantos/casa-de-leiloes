import type { LotSummary } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { useAuth } from '@/features/auth';
import { fetchLots, type ShowcaseStatus } from '../api';
import { formatRemaining, formatWhen } from '../time';
import { LotCard } from './LotCard';

/** Same cadence as the live room: a lot that ends or starts while the page is open changes the dot within this time. */
const LIVE_CHECK_MS = 3_000;
/** The featured lot moves on to the next live lot this often, looping over them (B45). */
const CAROUSEL_MS = 5_000;

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
  /** Every lot open right now; the featured block shows one at a time, moving on in a loop (B45). */
  const [liveLots, setLiveLots] = useState<LotSummary[]>([]);
  const [liveIndex, setLiveIndex] = useState(0);
  const liveLot = liveLots.length > 0 ? liveLots[liveIndex % liveLots.length] : undefined;
  const featuredIds = new Set(liveLots.map((lot) => lot.id));
  // The block is paused while a person points at it or focuses it, and never moves when they ask for less motion (B45).
  const [paused, setPaused] = useState(false);
  // A button holds the block still for anyone who cannot hover, or who needs it still (WCAG 2.2.2).
  const [held, setHeld] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => { setNow(Date.now()); }, 1_000);
    return () => { clearInterval(tick); };
  }, []);

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
    // A hidden tab asks nothing: the check runs again as soon as the tab is shown (B41).
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const request = ++latest;
      fetchLots({ status: 'live' })
        .then((lots) => {
          if (!cancelled && request === latest) {
            setHasLive(lots.length > 0);
            setLiveLots(lots);
          }
        })
        .catch(() => {
          if (!cancelled && request === latest) {
            setHasLive(false);
            setLiveLots([]);
          }
        });
    };
    check();
    const timer = setInterval(check, LIVE_CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [attempt]);

  useEffect(() => {
    const count = liveLots.length;
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (count < 2 || paused || held || reducedMotion) return;
    const timer = setInterval(() => { setLiveIndex((index) => (index + 1) % count); }, CAROUSEL_MS);
    return () => { clearInterval(timer); };
  }, [liveLots.length, paused, held]);

  // On the live tab the featured lots are above the list, so the list does not repeat them (B45).
  // Without a search, the live lots are above the list; a search lists what it finds, live lots included.
  const listed = tab === 'live' && query === '' && state.status === 'ready' ? state.lots.filter((lot) => !featuredIds.has(lot.id)) : state.status === 'ready' ? state.lots : [];

  return (
    <section aria-label="Vitrine">
      <div className="showcase-hero">
        <h1>Leilões ao vivo</h1>
        <form className="showcase-search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }} role="search">
          <label className="showcase-search-label">
            <span className="sr-only">Buscar por título</span>
            <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="Buscar por título, artista ou período..." />
          </label>
          {query !== '' && (
            <button type="button" className="search-clear" aria-label="Limpar busca" onClick={() => { setSearch(''); setQuery(''); }}>✕</button>
          )}
          <button type="submit" className="showcase-search-btn">Buscar</button>
        </form>
      </div>
      {liveLot && query === '' && (
        <section
          className="featured"
          aria-label="Lote ao vivo em destaque"
          onMouseEnter={() => { setPaused(true); }}
          onMouseLeave={() => { setPaused(false); }}
          onFocus={() => { setPaused(true); }}
          onBlur={() => { setPaused(false); }}
        >
          <div className="featured-media">
            <Link to={`/lotes/${liveLot.id}`} className="featured-cover" aria-hidden="true" tabIndex={-1}>
              <img src={liveLot.imageUrl} alt="" />
            </Link>
            <div className="featured-carousel-pill" role="group" aria-label="Controles do destaque">
              <button
                type="button"
                className="carousel-nav-btn"
                aria-label="Lote anterior"
                onClick={() => { setLiveIndex((index) => (index - 1 + liveLots.length) % liveLots.length); }}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <span className="carousel-counter" aria-hidden="true">
                Lote {(liveIndex % liveLots.length) + 1} de {liveLots.length}
              </span>
              <button
                type="button"
                className="carousel-nav-btn"
                onClick={() => { setLiveIndex((index) => (index + 1) % liveLots.length); }}
              >
                <span className="sr-only">Próximo lote</span>
                <span aria-hidden="true">›</span>
              </button>
              <span className="carousel-divider" aria-hidden="true" />
              <button
                type="button"
                className="carousel-pause-btn"
                onClick={() => { setHeld((value) => !value); }}
              >
                <span aria-hidden="true">{held ? '▶' : '⏸'}</span>
                <span>{held ? 'Retomar' : 'Pausar'}<span className="sr-only"> destaque</span></span>
              </button>
            </div>
          </div>
          <div className="featured-body">
            <div className="featured-badge-row">
              <span className="featured-status">
                <span className="live-dot" aria-hidden="true" />
                AO VIVO AGORA
              </span>
            </div>
            <Link to={`/lotes/${liveLot.id}`} className="featured-title">{liveLot.title}</Link>
            <div className="featured-stats">
              <div className="featured-stat-col">
                <span className="featured-stat-label">Lance atual</span>
                <strong className="featured-stat-value">{formatBRL(liveLot.currentAmountCents ?? liveLot.startingBidCents)}</strong>
                <small className="featured-stat-sub">+ {formatBRL(liveLot.incrementCents)} incremento mínimo</small>
              </div>
              <div className="featured-stat-col featured-stat-end">
                <span className="featured-stat-label">Encerra em</span>
                <strong className="featured-stat-countdown">{formatRemaining(Math.max(0, Date.parse(liveLot.endsAt) - now))}</strong>
                <small className="featured-stat-sub">{formatWhen(liveLot.endsAt)}</small>
              </div>
            </div>
            <div className="featured-actions">
              <Link className="featured-bid" to={`/lotes/${liveLot.id}`}>{isAuctioneer ? 'Ver lote' : 'Dar lance'}</Link>
              <Link className="featured-history" to={`/lotes/${liveLot.id}#historico`}>Histórico</Link>
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
        {state.status === 'ready' && state.lots.length > 0 && listed.length === 0 && (
          <p className="featured-all-note">Todos os lotes ao vivo estão no destaque acima.</p>
        )}
        {listed.length > 0 && (
          <div className="lot-rows">
            {listed.map((lot) => <LotCard key={lot.id} lot={lot} />)}
          </div>
        )}
      </section>
    </section>
  );
}
