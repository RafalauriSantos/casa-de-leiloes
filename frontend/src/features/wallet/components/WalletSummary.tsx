import type { WalletResponse } from '@casa/contracts';
import { formatBRL } from '@/lib/format';

export function WalletSummary({ wallet }: { wallet: WalletResponse }) {
  return (
    <dl aria-label="Saldos">
      <div><dt>Saldo total</dt><dd>{formatBRL(wallet.totalCents)}</dd></div>
      <div><dt>Comprometido em lances</dt><dd>{formatBRL(wallet.committedCents)}</dd></div>
      <div><dt>Disponível para lances</dt><dd><strong>{formatBRL(wallet.availableCents)}</strong></dd></div>
    </dl>
  );
}
