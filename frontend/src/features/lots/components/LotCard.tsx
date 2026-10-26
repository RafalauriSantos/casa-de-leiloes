import type { LotSummary } from '@casa/contracts';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { formatWhen, STATE_LABEL } from '../time';

export function LotCard({ lot }: { lot: LotSummary }) {
  const bid = lot.currentAmountCents ?? lot.startingBidCents;
  return (
    <article className="lot-card">
      <Link to={`/lotes/${lot.id}`}>
        <div className="lot-media">
          <img src={lot.imageUrl} alt={lot.title} loading="lazy" />
          {lot.state === 'live'
            ? <span className="live-badge"><span className="live-dot" aria-hidden="true" />AO VIVO</span>
            : <span className="state lot-state">{STATE_LABEL[lot.state]}</span>}
        </div>
        <h3>{lot.title}</h3>
      </Link>
      <div className="lot-card-foot">
        <div>
          <span className="label">{lot.currentAmountCents === null ? 'Lance inicial' : 'Lance atual'}</span>
          <strong className="amount">{formatBRL(bid)}</strong>
        </div>
        <small>Termina em {formatWhen(lot.endsAt)}</small>
      </div>
    </article>
  );
}
