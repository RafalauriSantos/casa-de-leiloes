import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signUpUser } from '../helpers/auth';
import { startTestServer, type TestServer } from '../helpers/server';
import { requireEnv } from '../helpers/test-config';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

const unauthenticated = { code: 'unauthenticated', message: expect.any(String) as string };

const roleOf = async (token: string) =>
  ((await (await fetch(`${server.url}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { role: string }).role;

describe('GET /api/me', () => {
  it('rejects a request without a token', async () => {
    const response = await fetch(`${server.url}/api/me`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(unauthenticated);
  });

  it('rejects a garbage token', async () => {
    const response = await fetch(`${server.url}/api/me`, { headers: { Authorization: 'Bearer not-a-jwt' } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(unauthenticated);
  });

  it('rejects a token whose payload was tampered with', async () => {
    const user = await signUpUser();
    const [header, payload, signature] = user.token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
    claims.sub = '00000000-0000-0000-0000-000000000000';
    const forged = [header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.');

    const response = await fetch(`${server.url}/api/me`, { headers: { Authorization: `Bearer ${forged}` } });
    expect(response.status).toBe(401);
  });

  it('returns the identity taken from the token', async () => {
    const user = await signUpUser({ displayName: 'Ana Teste' });
    const response = await fetch(`${server.url}/api/me`, { headers: { Authorization: `Bearer ${user.token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: user.id, role: 'bidder', displayName: 'Ana Teste' });
  });

  it('creates the profile and an empty wallet on sign-up', async () => {
    const user = await signUpUser();
    const rows = await server.db.query<{ total_cents: number; committed_cents: number }>(
      'select total_cents, committed_cents from public.wallets where user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ total_cents: 0, committed_cents: 0 }]);
  });

  it('gives the role chosen at sign-up: "Quero vender" is an auctioneer, "Quero comprar" a bidder (0.6)', async () => {
    const seller = await signUpUser({ metadata: { role: 'auctioneer' } });
    const buyer = await signUpUser({ metadata: { role: 'bidder' } });
    expect(await roleOf(seller.token)).toBe('auctioneer');
    expect(await roleOf(buyer.token)).toBe('bidder');
  });

  it('accepts no other role at sign-up, and the role cannot change after it (0.7)', async () => {
    const forged = await signUpUser({ metadata: { role: 'admin' } });
    const silent = await signUpUser();
    expect(await roleOf(forged.token)).toBe('bidder');
    expect(await roleOf(silent.token)).toBe('bidder');

    // A signed-in user can edit their own metadata; the role is read from the profile, written once at sign-up.
    const changed = await fetch(`${requireEnv('SUPABASE_URL')}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', apikey: requireEnv('SUPABASE_ANON_KEY'), Authorization: `Bearer ${silent.token}` },
      body: JSON.stringify({ data: { role: 'auctioneer' } }),
    });
    expect(changed.ok).toBe(true);
    expect(await roleOf(silent.token)).toBe('bidder');
  });
});
