import type { LotSummary } from '@casa/contracts';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { formatWhen, STATE_LABEL } from '../time';

/** One lot in the list: its title and state on the left, its bid on the right. */
export function LotCard({ lot }: { lot: LotSummary }) {
  const bid = lot.currentAmountCents ?? lot.startingBidCents;
  return (
    <article className="lot-row">
      <img src={lot.imageUrl} alt="" className="lot-thumb" loading="lazy" />
      <Link to={`/lotes/${lot.id}`}>
        <h3>{lot.title}</h3>
        <span className="lot-status">
          {lot.state === 'live'
            ? <span className="live-status">Ao vivo</span>
            : <span className="state">{STATE_LABEL[lot.state]}</span>}
          <small>Termina em {formatWhen(lot.endsAt)}</small>
        </span>
      </Link>
      <span className="lot-price">
        <span className="label">{lot.currentAmountCents === null ? 'Lance inicial' : 'Lance atual'}</span>
        <strong className="amount">{formatBRL(bid)}</strong>
      </span>
    </article>
  );
}
