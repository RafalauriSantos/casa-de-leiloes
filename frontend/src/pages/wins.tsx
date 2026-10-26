import { RequireRole } from '@/features/auth';
import { MyWins } from '@/features/wins';

export function WinsPage() {
  return <RequireRole role="bidder">{(token) => <MyWins token={token} />}</RequireRole>;
}
