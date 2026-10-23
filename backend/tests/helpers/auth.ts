import { randomBytes, randomUUID } from 'node:crypto';
import { requireEnv } from './test-config';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

interface SignUpResponse {
  access_token: string;
  user: { id: string };
}

/** Signs up a real user in the real Supabase Auth (email confirmation is off) and returns its JWT. */
export async function signUpUser(options: { displayName?: string; metadata?: Record<string, unknown> } = {}): Promise<TestUser> {
  const email = `t-${randomUUID()}@example.test`;
  const response = await fetch(`${requireEnv('SUPABASE_URL')}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: requireEnv('SUPABASE_ANON_KEY') },
    body: JSON.stringify({
      email,
      password: randomBytes(16).toString('hex'),
      data: { display_name: options.displayName, ...options.metadata },
    }),
  });
  if (!response.ok) throw new Error(`Sign-up failed: ${String(response.status)} ${await response.text()}`);
  const body = (await response.json()) as SignUpResponse;
  return { id: body.user.id, email, token: body.access_token };
}

/** Auctioneers are created by the seed, never by sign-up: tests promote a real user directly in the database. */
export async function promoteToAuctioneer(db: { query: (text: string, params?: readonly unknown[]) => Promise<unknown> }, userId: string): Promise<void> {
  await db.query("update public.profiles set role = 'auctioneer' where id = $1", [userId]);
}
