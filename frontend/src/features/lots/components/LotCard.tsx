import type { LotSummary } from '@casa/contracts';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { formatWhen, STATE_LABEL } from '../time';

/** One lot in the catalog grid: framed gallery thumbnail on the left, title, bid and status on the right. */
export function LotCard({ lot }: { lot: LotSummary }) {
  const bid = lot.currentAmountCents ?? lot.startingBidCents;
  return (
    <article className="lot-row">
      <div className="lot-thumb-frame">
        <img src={lot.imageUrl} alt="" className="lot-thumb" loading="lazy" />
      </div>
      <div className="lot-card-content">
        <Link to={`/lotes/${lot.id}`} className="lot-card-link">
          <h3>{lot.title}</h3>
          <span className="lot-price">
            <span className="label">{lot.currentAmountCents === null ? 'Lance inicial' : 'Lance atual'}</span>
            <strong className="amount">{formatBRL(bid)}</strong>
          </span>
          <span className="lot-status">
            {lot.state === 'live'
              ? <span className="live-status"><span className="live-dot" aria-hidden="true" /> Ao vivo</span>
              : <span className="state">{STATE_LABEL[lot.state]}</span>}
            <small>Termina em {formatWhen(lot.endsAt)}</small>
          </span>
        </Link>
      </div>
    </article>
  );
}
