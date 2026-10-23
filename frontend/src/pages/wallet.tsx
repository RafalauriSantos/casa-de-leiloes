import { RequireRole } from '@/features/auth';
import { WalletView } from '@/features/wallet';

export function WalletPage() {
  return <RequireRole role="bidder">{(token) => <WalletView token={token} />}</RequireRole>;
}
