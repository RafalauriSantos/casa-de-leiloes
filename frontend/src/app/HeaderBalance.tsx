import { useEffect, useState } from 'react';
import { fetchWallet } from '@/features/wallet';
import { formatBRL } from '@/lib/format';

/** The available balance in the header (the design's "Disponível"). Shown only when it is read; a failed read shows nothing. */
export function HeaderBalance({ token }: { token: string }) {
  const [available, setAvailable] = useState<number>();

  useEffect(() => {
    let cancelled = false;
    setAvailable(undefined);
    fetchWallet(token)
      .then((wallet) => { if (!cancelled) setAvailable(wallet.availableCents); })
      .catch(() => { if (!cancelled) setAvailable(undefined); });
    return () => { cancelled = true; };
  }, [token]);

  if (available === undefined) return null;
  return (
    <a href="/carteira" className="header-balance">
      <span>Disponível</span>
      <strong>{formatBRL(available)}</strong>
    </a>
  );
}
