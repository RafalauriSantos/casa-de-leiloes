import type { MeResponse } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { signOut } from '../api';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; me: MeResponse };

const ROLE_LABEL = { auctioneer: 'Leiloeiro', bidder: 'Licitante' } as const;

export function MeCard({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    apiFetch<MeResponse>('/api/me', { token })
      .then((me) => { if (!cancelled) setState({ status: 'ready', me }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <section aria-label="Sua conta">
      {state.status === 'loading' && <p>Carregando…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <p>
          Olá, <strong>{state.me.displayName}</strong> ({ROLE_LABEL[state.me.role]})
        </p>
      )}
      <button type="button" onClick={() => void signOut()}>Sair</button>
    </section>
  );
}
