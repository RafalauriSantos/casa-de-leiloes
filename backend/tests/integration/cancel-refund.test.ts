import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';

// B19 (criterion 9.1, an optional of the brief): cancelling a lot with bids refunds the committed money automatically.

let server: TestServer;
let met: MetStub;
let auctioneer: TestUser;

beforeAll(async () => {
  met = await startMetStub();
  server = await startTestServer({ metApiUrl: met.baseUrl });
  auctioneer = await createAuctioneer(server);
});
afterAll(async () => {
  await server.close();
  await met.close();
});

const DEPOSIT = 1_000_000;
const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });

async function bidder(): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${server.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: DEPOSIT }),
  });
  expect(deposit.status).toBe(201);
  return user;
}

async function liveLot(): Promise<OwnLot> {
  const created = await fetch(`${server.url}/api/lots`, {
    method: 'POST',
    headers: json(auctioneer),
    body: JSON.stringify(lotBody(await dbNow(server), { startingBidCents: 50_000, incrementCents: 5_000 })),
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [
    lot.id,
    new Date(now.getTime() - minutes(5)),
    new Date(now.getTime() + minutes(60)),
  ]);
  return lot;
}

const bid = (lotId: string, user: TestUser, amountCents: number) =>
  fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
const cancel = (lotId: string) => fetch(`${server.url}/api/lots/${lotId}/cancel`, { method: 'POST', headers: json(auctioneer) });

async function committed(users: TestUser[]): Promise<number> {
  const [row] = await server.db.query<{ sum: number }>('select coalesce(sum(committed_cents), 0)::int as sum from public.wallets where user_id = any($1::uuid[])', [
    users.map((user) => user.id),
  ]);
  return row?.sum ?? -1;
}

describe('cancelling a lot with bids refunds the committed money (9.1)', () => {
  it('returns the leader\'s committed money at once, charges nobody, and refuses later bids without moving money', async () => {
    const [ana, beto] = [await bidder(), await bidder()];
    const lot = await liveLot();
    expect((await bid(lot.id, ana, 50_000)).status).toBe(201);
    expect((await bid(lot.id, beto, 55_000)).status).toBe(201);
    expect(await committed([ana, beto])).toBe(55_000);

    const response = await cancel(lot.id);
    expect(response.status).toBe(200);
    expect(((await response.json()) as OwnLot).state).toBe('cancelled');

    expect(await committed([ana, beto])).toBe(0);
    const totals = await server.db.query<{ total_cents: number }>('select total_cents from public.wallets where user_id = any($1::uuid[])', [[ana.id, beto.id]]);
    expect(totals.map((row) => row.total_cents)).toEqual([DEPOSIT, DEPOSIT]);
    const [ledger] = await server.db.query<{ rows: number }>('select count(*)::int as rows from public.wallet_ledger where lot_id = $1', [lot.id]);
    expect(ledger?.rows).toBe(0);

    const late = await bid(lot.id, ana, 60_000);
    expect(late.status).toBe(409);
    expect(((await late.json()) as { code: string }).code).toBe('lot_cancelled');
    expect(await committed([ana, beto])).toBe(0);
  });

  it('leaves no committed money behind when a cancel races with many bids', async () => {
    const bidders = await Promise.all(Array.from({ length: 6 }, () => bidder()));
    const lot = await liveLot();
    expect((await bid(lot.id, bidders[0] as TestUser, 50_000)).status).toBe(201);

    const answers = await Promise.all([
      ...bidders.slice(1).map((user, index) => bid(lot.id, user, 55_000 + index * 5_000)),
      cancel(lot.id),
    ]);
    expect(answers.at(-1)?.status).toBe(200);
    // Each bid either landed before the cancel or was refused: below a bid that won the race, or after the cancel. A
    // cancelled lot is hidden from the public, so a bid that reads it after the cancel gets not_found, like its page.
    for (const answer of answers.slice(0, -1)) {
      if (answer.status !== 201) {
        expect(['lot_cancelled', 'not_found', 'bid_below_minimum']).toContain(((await answer.json()) as { code: string }).code);
      }
    }

    const [row] = await server.db.query<{ status: string }>('select status from public.lots where id = $1', [lot.id]);
    expect(row?.status).toBe('cancelled');
    expect(await committed(bidders)).toBe(0);
  });
});
