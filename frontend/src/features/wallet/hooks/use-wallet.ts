import type { WalletResponse } from '@casa/contracts';
import { useCallback, useEffect, useState } from 'react';
import { fetchWallet } from '../api';

export type WalletState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; wallet: WalletResponse };

export function useWallet(token: string): { state: WalletState; setWallet: (wallet: WalletResponse) => void; reload: () => void } {
  const [state, setState] = useState<WalletState>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchWallet(token)
      .then((wallet) => { if (!cancelled) setState({ status: 'ready', wallet }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [token, version]);

  const setWallet = useCallback((wallet: WalletResponse) => { setState({ status: 'ready', wallet }); }, []);
  const reload = useCallback(() => { setState({ status: 'loading' }); setVersion((v) => v + 1); }, []);
  return { state, setWallet, reload };
}
