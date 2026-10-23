import { RequireRole } from '@/features/auth';
import { AuctioneerPanel } from '@/features/lots';

export function AuctioneerPage() {
  return <RequireRole role="auctioneer">{(token) => <AuctioneerPanel token={token} />}</RequireRole>;
}
