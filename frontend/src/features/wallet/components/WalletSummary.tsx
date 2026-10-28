import type { WalletResponse } from '@casa/contracts';
import { formatBRL } from '@/lib/format';

/** What the bidder can spend comes first and large; the total and the committed amount follow, quieter. */
export function WalletSummary({ wallet }: { wallet: WalletResponse }) {
  return (
    <dl aria-label="Saldos">
      <div><dt>Disponível para lances</dt><dd><strong>{formatBRL(wallet.availableCents)}</strong></dd></div>
      <div><dt>Saldo total</dt><dd>{formatBRL(wallet.totalCents)}</dd></div>
      <div><dt>Comprometido em lances</dt><dd>{formatBRL(wallet.committedCents)}</dd></div>
    </dl>
  );
}
