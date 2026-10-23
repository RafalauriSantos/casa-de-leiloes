import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type SessionState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; session: Session };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    const toState = (session: Session | null): SessionState => (session ? { status: 'signed-in', session } : { status: 'signed-out' });
    void supabase.auth.getSession().then(({ data }) => {
      setState(toState(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(toState(session));
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
