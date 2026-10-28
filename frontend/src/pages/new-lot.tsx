import { RequireRole } from '@/features/auth';
import { NewLotFlow } from '@/features/lots';

export function NewLotPage() {
  return <RequireRole role="auctioneer">{(token) => <NewLotFlow token={token} />}</RequireRole>;
}
