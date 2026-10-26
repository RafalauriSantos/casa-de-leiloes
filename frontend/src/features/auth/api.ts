import { supabase } from '@/lib/supabase';

export type AuthResult = { ok: true } | { ok: true; notice: string } | { ok: false; message: string };

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message for every failure: never reveal whether the e-mail exists.
  return error ? { ok: false, message: 'E-mail ou senha incorretos.' } : { ok: true };
}

/** What a sign-up answer means for the screen. No session means the project wants the e-mail confirmed first. */
export function signUpOutcome(answer: { hasError: boolean; hasSession: boolean }): AuthResult {
  if (answer.hasError) return { ok: false, message: 'Não foi possível criar a conta com esses dados.' };
  if (!answer.hasSession) return { ok: true, notice: 'Conta criada. Confirme o e-mail que enviamos para entrar.' };
  return { ok: true };
}

/** The role a new account asks for: "Quero comprar" or "Quero vender". The database reads it once, at creation (D24). */
export type SignUpRole = 'bidder' | 'auctioneer';

export async function signUp(email: string, password: string, displayName: string, role: SignUpRole): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, role } } });
  return signUpOutcome({ hasError: error !== null, hasSession: data.session !== null });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
