import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchWallet } from '@/features/wallet';
import { formatBRL } from '@/lib/format';
import { onWalletChange } from '@/lib/wallet-events';

/**
 * The available balance, read again when the screen changes and when a deposit or a bid changes the wallet.
 * A failed read gives nothing: the header never shows a balance it did not read.
 */
export function useAvailableBalance(token: string | undefined, screen: string): number | undefined {
  const [available, setAvailable] = useState<number>();
  const [changes, setChanges] = useState(0);

  useEffect(() => onWalletChange(() => { setChanges((n) => n + 1); }), []);

  useEffect(() => {
    let cancelled = false;
    if (token === undefined) {
      setAvailable(undefined);
      return;
    }
    fetchWallet(token)
      .then((wallet) => { if (!cancelled) setAvailable(wallet.availableCents); })
      .catch(() => { if (!cancelled) setAvailable(undefined); });
    return () => { cancelled = true; };
  }, [token, screen, changes]);

  return available;
}

export function HeaderBalance({ availableCents }: { availableCents: number }) {
  return (
    <Link to="/carteira" className="header-balance">
      <span>Saldo</span>
      <strong>{formatBRL(availableCents)}</strong>
    </Link>
  );
}
