import type { MeResponse } from '@casa/contracts';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
  const known = useRef<MeResponse>(undefined);

  useEffect(() => {
    let current = 0;
    const apply = (session: Session | null) => {
      const attempt = ++current;
      if (!session) {
        known.current = undefined;
        setState({ status: 'signed-out' });
        return;
      }
      const token = session.access_token;
      // Same user with a fresh token (background refresh, tab focus): swap the token in place so the
      // open screens keep their state instead of being torn down and rebuilt.
      if (known.current?.id === session.user.id) {
        setState({ status: 'signed-in', token, me: known.current });
        return;
      }
      setState({ status: 'loading' });
      apiFetch<MeResponse>('/api/me', { token })
        .then((me) => {
          if (attempt !== current) return;
          known.current = me;
          setState({ status: 'signed-in', token, me });
        })
        .catch((error: unknown) => {
          if (attempt === current) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
        });
    };

    void supabase.auth.getSession().then(({ data }) => {
      apply(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session);
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
