import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEPOSIT_MAX_CENTS, DEPOSIT_MIN_CENTS, type WalletResponse } from '@casa/contracts';
import { promoteToAuctioneer, signUpUser, type TestUser } from '../helpers/auth';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

const api = (path: string, user?: TestUser, init: RequestInit & { key?: string | null } = {}) => {
  const { key, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (user) headers.set('Authorization', `Bearer ${user.token}`);
  if (rest.body !== undefined) headers.set('Content-Type', 'application/json');
  if (key !== null && rest.method === 'POST') headers.set('Idempotency-Key', key ?? randomUUID());
  return fetch(`${server.url}${path}`, { ...rest, headers });
};
const deposit = (user: TestUser, amountCents: unknown, key?: string | null) =>
  api('/api/wallet/deposits', user, { method: 'POST', body: JSON.stringify({ amountCents }), key });
const wallet = async (user: TestUser) => (await (await api('/api/wallet', user)).json()) as WalletResponse;
const code = async (response: Response) => ((await response.json()) as { code: string }).code;

describe('access control', () => {
  it('needs a token', async () => {
    expect((await api('/api/wallet')).status).toBe(401);
    expect((await deposit(undefined as never, 1000)).status).toBe(401);
  });

  it('is for bidders only: an auctioneer gets 403 on both routes', async () => {
    const auctioneer = await signUpUser();
    await promoteToAuctioneer(server.db, auctioneer.id);
    const read = await api('/api/wallet', auctioneer);
    expect(read.status).toBe(403);
    expect(await code(read)).toBe('forbidden');
    expect((await deposit(auctioneer, 1000)).status).toBe(403);
  });
});

describe('GET /api/wallet', () => {
  it('starts empty with the invariant available = total - committed', async () => {
    const user = await signUpUser();
    expect(await wallet(user)).toEqual({ totalCents: 0, committedCents: 0, availableCents: 0 });
  });
});

describe('POST /api/wallet/deposits', () => {
  it('credits the wallet and answers 201 with the new balance', async () => {
    const user = await signUpUser();
    const response = await deposit(user, 25_000);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ totalCents: 25_000, committedCents: 0, availableCents: 25_000 });
    expect(await wallet(user)).toEqual({ totalCents: 25_000, committedCents: 0, availableCents: 25_000 });
  });

  it('records the movement in the ledger', async () => {
    const user = await signUpUser();
    await deposit(user, 1_234);
    const rows = await server.db.query<{ kind: string; amount_cents: number }>('select kind, amount_cents from public.wallet_ledger where user_id = $1', [user.id]);
    expect(rows).toEqual([{ kind: 'deposit', amount_cents: 1_234 }]);
  });

  it.each([
    ['zero', 0],
    ['negative', -500],
    ['below the minimum', DEPOSIT_MIN_CENTS - 1],
    ['above the maximum', DEPOSIT_MAX_CENTS + 1],
    ['fractional', 150.5],
    ['text', '1000'],
    ['missing', undefined],
  ])('refuses an amount that is %s and changes nothing', async (_name, amount) => {
    const user = await signUpUser();
    const response = await deposit(user, amount);
    expect(response.status).toBe(422);
    expect(await code(response)).toBe('validation_error');
    expect((await wallet(user)).totalCents).toBe(0);
  });

  it('requires a valid Idempotency-Key', async () => {
    const user = await signUpUser();
    expect((await deposit(user, 1_000, null)).status).toBe(422);
    expect((await deposit(user, 1_000, 'not-a-uuid')).status).toBe(422);
    expect((await wallet(user)).totalCents).toBe(0);
  });

  it('credits once when the same request is retried (double click, network retry)', async () => {
    const user = await signUpUser();
    const key = randomUUID();
    const first = await deposit(user, 5_000, key);
    const retry = await deposit(user, 5_000, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ totalCents: 5_000, committedCents: 0, availableCents: 5_000 });
    expect((await wallet(user)).totalCents).toBe(5_000);
  });

  it('refuses a key reused with a different amount', async () => {
    const user = await signUpUser();
    const key = randomUUID();
    await deposit(user, 5_000, key);
    const conflict = await deposit(user, 9_000, key);
    expect(conflict.status).toBe(409);
    expect(await code(conflict)).toBe('idempotency_conflict');
    expect((await wallet(user)).totalCents).toBe(5_000);
  });

  it('sums simultaneous deposits with different keys', async () => {
    const user = await signUpUser();
    const responses = await Promise.all(Array.from({ length: 20 }, () => deposit(user, 1_000)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await wallet(user)).toEqual({ totalCents: 20_000, committedCents: 0, availableCents: 20_000 });
  });

  it('credits exactly once when many identical requests race with the same key', async () => {
    const user = await signUpUser();
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 10 }, () => deposit(user, 7_000, key)));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(9);
    expect((await wallet(user)).totalCents).toBe(7_000);
  });

  it("never touches another user's wallet", async () => {
    const [a, b] = await Promise.all([signUpUser(), signUpUser()]);
    await deposit(a, 3_000);
    expect((await wallet(b)).totalCents).toBe(0);
  });
});

describe('database invariants', () => {
  it('refuses committed above total even when written directly', async () => {
    const user = await signUpUser();
    await deposit(user, 1_000);
    await expect(server.db.query('update public.wallets set committed_cents = 1001 where user_id = $1', [user.id])).rejects.toThrow(/wallets_committed_within_total/);
  });

  it('refuses a negative balance when written directly', async () => {
    const user = await signUpUser();
    await expect(server.db.query('update public.wallets set total_cents = -1 where user_id = $1', [user.id])).rejects.toThrow();
  });
});
