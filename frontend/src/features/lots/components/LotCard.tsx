import type { LotSummary } from '@casa/contracts';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { formatRemaining, formatWhen, STATE_LABEL } from '../time';

/** One lot in the catalog grid: framed gallery thumbnail on the left, title, bid and status on the right. */
export function LotCard({ lot }: { lot: LotSummary }) {
  const bid = lot.currentAmountCents ?? lot.startingBidCents;
  const isStarting = lot.currentAmountCents === null;
  const isLive = lot.state === 'live';
  const endsAtMs = Date.parse(lot.endsAt);
  const remaining = Math.max(0, endsAtMs - Date.now());

  return (
    <article className="lot-card" data-state={lot.state}>
      <Link to={`/lotes/${lot.id}`} className="lot-card-thumb-wrap" tabIndex={-1} aria-hidden="true">
        <img src={lot.imageUrl} alt="" className="lot-card-thumb" loading="lazy" />
      </Link>
      <div className="lot-card-body">
        <div className="lot-card-status-row">
          {isLive ? (
            <span className="lot-card-badge live-status">
              <span className="live-dot" aria-hidden="true" /> Ao vivo
            </span>
          ) : (
            <span className="lot-card-badge state">
              {STATE_LABEL[lot.state]}
            </span>
          )}
        </div>
        <h3 className="lot-card-title">
          <Link to={`/lotes/${lot.id}`}>{lot.title}</Link>
        </h3>
        <div className="lot-card-pricing">
          <span className="lot-card-price-label">{isStarting ? 'Lance inicial' : 'Lance atual'}</span>
          <strong className="lot-card-price-val">{formatBRL(bid)}</strong>
          <span className="lot-card-increment">+ {formatBRL(lot.incrementCents)} incremento mínimo</span>
        </div>
        <div className="lot-card-timing">
          <div className="lot-card-countdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Termina em {formatRemaining(remaining)}</span>
          </div>
          <small className="lot-card-date">{formatWhen(lot.endsAt)}</small>
        </div>
        <div className="lot-card-action">
          <Link to={`/lotes/${lot.id}`} className="lot-card-btn">Ver lote</Link>
        </div>
      </div>
    </article>
  );
}
