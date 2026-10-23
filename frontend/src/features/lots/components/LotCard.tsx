import type { LotSummary } from '@casa/contracts';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { formatWhen, STATE_LABEL } from '../time';

export function LotCard({ lot }: { lot: LotSummary }) {
  const bid = lot.currentAmountCents ?? lot.startingBidCents;
  return (
    <article className="lot-card">
      <Link to={`/lotes/${lot.id}`}>
        <img src={lot.imageUrl} alt={lot.title} loading="lazy" />
        <h3>{lot.title}</h3>
      </Link>
      <p>
        <span className="state">{STATE_LABEL[lot.state]}</span>{' '}
        {lot.currentAmountCents === null ? 'Lance inicial' : 'Lance atual'} <strong>{formatBRL(bid)}</strong>
      </p>
      <p><small>Termina em {formatWhen(lot.endsAt)}</small></p>
    </article>
  );
}
