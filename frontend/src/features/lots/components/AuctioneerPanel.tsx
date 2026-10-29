import { Link, useLocation } from 'react-router-dom';
import { OwnLots } from './OwnLots';

/** The notice a screen left for the panel when it sent the auctioneer back here (a published lot). */
function noticeOf(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return undefined;
  return typeof state.notice === 'string' ? state.notice : undefined;
}

export function AuctioneerPanel({ token }: { token: string }) {
  const notice = noticeOf(useLocation().state);
  return (
    <section aria-label="Painel do leiloeiro">
      <header className="panel-head">
        <h1>Painel do leiloeiro</h1>
        <Link className="my-lot-action" to="/leiloeiro/novo">Novo lote</Link>
      </header>
      {notice && <p role="status" className="notice-ok">{notice}</p>}
      <OwnLots token={token} />
    </section>
  );
}
