import { supabase } from '@/lib/supabase';

export type AuthResult = { ok: true } | { ok: true; notice: string } | { ok: false; message: string };

/** The part of an Auth error that tells the causes apart; `code` is the Auth error code when the server sends one. */
export interface SignInError {
  code?: string;
  status?: number;
}

/**
 * What a failed sign-in says. A wrong e-mail and password share one message, so the screen never reveals whether the
 * e-mail exists. Everything else says what happened, and an unknown failure is never blamed on the person.
 */
export function signInFailure(error: SignInError): AuthResult {
  if (error.code === 'invalid_credentials') return { ok: false, message: 'E-mail ou senha incorretos.' };
  if (error.code === 'email_not_confirmed') return { ok: false, message: 'Confirme o e-mail que enviamos antes de entrar.' };
  if (error.code === 'over_request_rate_limit' || error.status === 429) {
    return { ok: false, message: 'Muitas tentativas. Tente de novo em alguns minutos.' };
  }
  return { ok: false, message: 'Não foi possível entrar agora. Tente de novo em instantes.' };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? signInFailure(error) : { ok: true };
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
