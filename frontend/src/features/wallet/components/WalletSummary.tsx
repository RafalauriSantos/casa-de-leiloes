import type { WalletResponse } from '@casa/contracts';
import { formatBRL } from '@/lib/format';

export function WalletSummary({ wallet }: { wallet: WalletResponse }) {
  // The bar shows how much of the total is committed to leads (the design's balance bar).
  const committedPct = wallet.totalCents === 0 ? 0 : Math.round((wallet.committedCents / wallet.totalCents) * 100);
  return (
    <>
      <div className="balance-bar" role="img" aria-label={`${committedPct}% do saldo total está comprometido em lances`}>
        <span style={{ width: `${committedPct}%` }} />
      </div>
      <dl aria-label="Saldos">
        <div><dt>Saldo total</dt><dd>{formatBRL(wallet.totalCents)}</dd></div>
        <div><dt>Comprometido em lances</dt><dd>{formatBRL(wallet.committedCents)}</dd></div>
        <div><dt>Disponível para lances</dt><dd><strong>{formatBRL(wallet.availableCents)}</strong></dd></div>
      </dl>
    </>
  );
}
