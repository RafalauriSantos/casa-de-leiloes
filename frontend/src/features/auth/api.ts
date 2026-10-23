import { supabase } from '@/lib/supabase';

export type AuthResult = { ok: true } | { ok: false; message: string };

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message for every failure: never reveal whether the e-mail exists.
  return error ? { ok: false, message: 'E-mail ou senha incorretos.' } : { ok: true };
}

export async function signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
  return error ? { ok: false, message: 'Não foi possível criar a conta com esses dados.' } : { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
