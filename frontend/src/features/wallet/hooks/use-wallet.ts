import type { WalletResponse } from '@casa/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWallet } from '../api';

export type WalletState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; wallet: WalletResponse };

export function useWallet(token: string): { state: WalletState; setWallet: (wallet: WalletResponse) => void; reload: () => void } {
  const [state, setState] = useState<WalletState>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  // Every read and every deposit result takes a number; only the newest may update the screen,
  // so a slow older read can never overwrite a balance that is already newer.
  const latest = useRef(0);

  useEffect(() => {
    const mine = ++latest.current;
    fetchWallet(token)
      .then((wallet) => { if (mine === latest.current) setState({ status: 'ready', wallet }); })
      .catch((error: unknown) => {
        if (mine === latest.current) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
  }, [token, version]);

  const setWallet = useCallback((wallet: WalletResponse) => {
    latest.current++;
    setState({ status: 'ready', wallet });
  }, []);
  const reload = useCallback(() => { setState({ status: 'loading' }); setVersion((v) => v + 1); }, []);
  return { state, setWallet, reload };
}
