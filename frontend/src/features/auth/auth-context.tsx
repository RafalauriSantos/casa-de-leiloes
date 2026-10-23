import type { MeResponse } from '@casa/contracts';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; token: string; me: MeResponse }
  | { status: 'error'; message: string };

const AuthContext = createContext<AuthState>({ status: 'loading' });

/** One subscription to Supabase Auth for the whole app; the role comes from our API (/api/me), not from the token. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let current = 0;
    const apply = (token: string | undefined) => {
      const attempt = ++current;
      if (!token) {
        setState({ status: 'signed-out' });
        return;
      }
      setState({ status: 'loading' });
      apiFetch<MeResponse>('/api/me', { token })
        .then((me) => {
          if (attempt === current) setState({ status: 'signed-in', token, me });
        })
        .catch((error: unknown) => {
          if (attempt === current) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
        });
    };

    void supabase.auth.getSession().then(({ data }) => {
      apply(data.session?.access_token);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.access_token);
    });
    return () => {
      current++;
      data.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
