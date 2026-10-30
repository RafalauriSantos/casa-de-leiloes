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
  const featuredIds = new Set(liveLots.length <= 2 ? liveLots.map((lot) => lot.id) : (liveLot ? [liveLot.id] : []));
  // The block is paused while a person points at it or focuses it, and never moves when they ask for less motion (B45).
  const [page, setPage] = useState(1);
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

  useEffect(() => {
    setPage(1);
  }, [tab, query]);

  // On the live tab the featured lots are above the list, so the list does not repeat them (B45).
  // Without a search, the live lots are above the list; a search lists what it finds, live lots included.
  const listed = tab === 'live' && query === '' && state.status === 'ready' ? state.lots.filter((lot) => !featuredIds.has(lot.id)) : state.status === 'ready' ? state.lots : [];
  const PAGE_SIZE = 4;
  const totalPages = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageLots = listed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section aria-label="Vitrine">
      <div className="showcase-hero">
        <div className="showcase-hero-intro">
          <h1>Leilões ao vivo</h1>
          <p className="showcase-hero-sub">Acompanhe os lotes em tempo real e participe dos pregões.</p>
        </div>
        <form className="showcase-search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }} role="search">
          <label className="showcase-search-label">
            <span className="sr-only">Buscar por título</span>
            <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="Buscar por título, artista ou período..." />
          </label>
          <button type="submit" className="showcase-search-btn">Buscar</button>
        </form>
      </div>
      {liveLot && query === '' && (
        <section
          className="featured"
          aria-label="Lote ao vivo em destaque"
          data-paused={paused || held ? '' : undefined}
          onMouseEnter={() => { setPaused(true); }}
          onMouseLeave={() => { setPaused(false); }}
          onFocus={() => { setPaused(true); }}
          onBlur={() => { setPaused(false); }}
        >
          <div className="featured-media">
            <div key={liveLot.id} className="featured-cover">
              <img src={liveLot.imageUrl} alt="" />
              <span className="featured-progress" aria-hidden="true" />
            </div>
            <div className="featured-carousel-pill" role="group" aria-label="Controles do destaque">
              <span className="carousel-counter" aria-hidden="true">
                ‹ Lote {(liveIndex % liveLots.length) + 1} de {liveLots.length} ›
              </span>
              <span className="carousel-divider" aria-hidden="true" />
              <button
                type="button"
                className="carousel-pause-btn"
                aria-label={held ? 'Retomar destaque' : 'Pausar destaque'}
                onClick={() => { setHeld((value) => !value); }}
              >
                <span aria-hidden="true">{held ? '▶' : '⏸'}</span>
                <span>{held ? 'Retomar' : 'Pausar'}</span>
              </button>
            </div>
          </div>
          <div key={liveLot.id} className="featured-body">
            <div className="featured-badge-row">
              <span className="featured-status">
                <span className="live-dot" aria-hidden="true" />
                AO VIVO
              </span>
            </div>
            <Link to={`/lotes/${liveLot.id}`} className="featured-title">{liveLot.title}</Link>
            <div className="featured-stats">
              <div className="featured-stat-col">
                <span className="featured-stat-label">LANCE ATUAL</span>
                <strong className="featured-stat-value">{formatBRL(liveLot.currentAmountCents ?? liveLot.startingBidCents)}</strong>
                <small className="featured-stat-sub">+ {formatBRL(liveLot.incrementCents)} incremento mínimo</small>
              </div>
              <div className="featured-stat-col featured-stat-end">
                <span className="featured-stat-label">ENCERRA EM</span>
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
      <section className="upcoming" aria-label="Próximos leilões">
        <div className="upcoming-head">
          <div className="catalog-title-wrap">
            <h2 id="upcoming-title">Explorar lotes</h2>
            <span className="catalog-title-dash" aria-hidden="true" />
          </div>
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
                {item.value === 'scheduled' && (
                  <svg className="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                )}
                {item.value === 'ended' && (
                  <svg className="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
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
          <>
            <div className="lot-rows">
              {pageLots.map((lot) => <LotCard key={lot.id} lot={lot} />)}
            </div>
            {totalPages > 1 && (
              <nav className="catalog-pagination-row" aria-label="Paginação do catálogo">
                <button
                  type="button"
                  className="pagination-arrow"
                  aria-label="Página anterior"
                  disabled={safePage <= 1}
                  onClick={() => { setPage((p) => Math.max(1, p - 1)); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`pagination-page ${safePage === p ? 'active' : ''}`}
                    aria-current={safePage === p ? 'page' : undefined}
                    onClick={() => { setPage(p); }}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  className="pagination-arrow"
                  aria-label="Próxima página"
                  disabled={safePage >= totalPages}
                  onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </section>
  );
}
