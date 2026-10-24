import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

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

const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });

async function bidder(depositCents = 1_000_000): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${server.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: depositCents }),
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

const bid = async (lotId: string, user: TestUser, amountCents: number) => {
  const response = await fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
  expect(response.status).toBe(201);
};

/** Moves the lot's end into the past, as if its time had come. The bids stay as they were placed. */
async function endLot(lotId: string): Promise<void> {
  const now = await dbNow(server);
  await server.db.query('update public.lots set ends_at = $2 where id = $1', [lotId, new Date(now.getTime() - 1_000)]);
}

async function balances(user: TestUser): Promise<{ total: number; committed: number }> {
  const [row] = await server.db.query<{ total_cents: number; committed_cents: number }>(
    'select total_cents, committed_cents from public.wallets where user_id = $1',
    [user.id],
  );
  if (!row) throw new Error('wallet missing');
  return { total: row.total_cents, committed: row.committed_cents };
}

async function lotState(lotId: string) {
  const [row] = await server.db.query<{ settled_at: Date | null; outcome: string | null }>(
    'select settled_at, outcome from public.lots where id = $1',
    [lotId],
  );
  if (!row) throw new Error('lot missing');
  return row;
}

/** The cron route, with its secret. Returns the HTTP status and how many lots it settled and how many it could not. */
async function closeDue(): Promise<{ status: number; settled: number; failed: number }> {
  const response = await fetch(`${server.url}/api/internal/close-due`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${testConfig().cronSecret}` },
  });
  return { status: response.status, ...((await response.json()) as { settled: number; failed: number }) };
}

const ledgerOf = (lotId: string) =>
  server.db.query<{ user_id: string; kind: string; amount_cents: number }>(
    'select user_id, kind, amount_cents from public.wallet_ledger where lot_id = $1 order by kind',
    [lotId],
  );

describe('5.1 the lot closes at its time, with nobody looking', () => {
  it('settles an ended lot on the cron call, and leaves a lot that has not ended alone', async () => {
    const ended = await liveLot();
    await bid(ended.id, await bidder(), 50_000);
    await endLot(ended.id);
    const running = await liveLot();
    await bid(running.id, await bidder(), 50_000);

    await closeDue();

    expect((await lotState(ended.id)).settled_at).not.toBeNull();
    expect((await lotState(running.id)).settled_at).toBeNull();
  });
});

describe('5.2 the winner pays, the auctioneer is credited, outbid money is released, a receipt is written', () => {
  it('moves the winning amount and writes one receipt for the lot', async () => {
    const lot = await liveLot();
    const first = await bidder();
    const winner = await bidder();
    const auctioneerBefore = await balances(auctioneer);
    const winnerBefore = await balances(winner);

    await bid(lot.id, first, 50_000);
    await bid(lot.id, winner, 55_000);
    await endLot(lot.id);
    await closeDue();

    const state = await lotState(lot.id);
    expect(state.settled_at).not.toBeNull();
    expect(state.outcome).toBe('sold');
    expect(await balances(winner)).toEqual({ total: winnerBefore.total - 55_000, committed: 0 });
    expect((await balances(first)).committed).toBe(0);
    expect(await balances(auctioneer)).toEqual({ total: auctioneerBefore.total + 55_000, committed: auctioneerBefore.committed });

    const receipts = await server.db.query<{ winner_id: string; amount_cents: number; head_seq: number }>(
      'select winner_id, amount_cents, head_seq from public.receipts where lot_id = $1',
      [lot.id],
    );
    expect(receipts).toEqual([{ winner_id: winner.id, amount_cents: 55_000, head_seq: 2 }]);
  });
});

describe('5.3 a lot without bids closes without a winner', () => {
  it('records no sale, moves no money and writes no receipt', async () => {
    const lot = await liveLot();
    const before = await balances(auctioneer);
    await endLot(lot.id);
    await closeDue();

    const state = await lotState(lot.id);
    expect(state.settled_at).not.toBeNull();
    expect(state.outcome).toBe('no_bids');
    expect(await balances(auctioneer)).toEqual(before);
    expect(await ledgerOf(lot.id)).toEqual([]);
    expect(await server.db.query('select 1 from public.receipts where lot_id = $1', [lot.id])).toEqual([]);
  });
});

describe('5.4 settlement happens once, even when it is triggered many times at once', () => {
  it('writes one debit, one credit and one receipt under ten parallel cron calls', async () => {
    const lot = await liveLot();
    const winner = await bidder();
    await bid(lot.id, winner, 60_000);
    await endLot(lot.id);
    const winnerBefore = await balances(winner);
    const auctioneerBefore = await balances(auctioneer);

    await Promise.all(Array.from({ length: 10 }, () => closeDue()));

    expect(await ledgerOf(lot.id)).toHaveLength(2);
    expect(await balances(winner)).toEqual({ total: winnerBefore.total - 60_000, committed: 0 });
    expect(await balances(auctioneer)).toEqual({ total: auctioneerBefore.total + 60_000, committed: auctioneerBefore.committed });
    const receipts = await server.db.query('select 1 from public.receipts where lot_id = $1', [lot.id]);
    expect(receipts).toHaveLength(1);
  });
});

describe('5.5 the money in the system does not change, only moves', () => {
  it('nets the lot ledger to zero and moves the same amount out of the winner and into the auctioneer', async () => {
    const lot = await liveLot();
    const winner = await bidder();
    await bid(lot.id, winner, 70_000);
    await endLot(lot.id);
    const winnerBefore = await balances(winner);
    const auctioneerBefore = await balances(auctioneer);

    await closeDue();

    const ledger = await ledgerOf(lot.id);
    expect(ledger.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(0);
    expect(winnerBefore.total - (await balances(winner)).total).toBe(70_000);
    expect((await balances(auctioneer)).total - auctioneerBefore.total).toBe(70_000);
  });
});

describe('a settlement that cannot prove its history is refused, not forced through', () => {
  it('leaves the lot unsettled and reports it as failed when the head copy does not match the chain', async () => {
    const lot = await liveLot();
    const winner = await bidder();
    await bid(lot.id, winner, 65_000);
    await endLot(lot.id);
    const [original] = await server.db.query<{ head_hash: string }>('select head_hash from public.lots where id = $1', [lot.id]);
    await server.db.query("update public.lots set head_hash = repeat('0', 64) where id = $1", [lot.id]);
    const winnerBefore = await balances(winner);

    try {
      const result = await closeDue();

      expect(result.status).toBe(500);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect((await lotState(lot.id)).settled_at).toBeNull();
      expect(await balances(winner)).toEqual(winnerBefore);
      expect(await ledgerOf(lot.id)).toEqual([]);
    } finally {
      // Restore the head so the lot is not left failing in the shared database for later tests.
      await server.db.query('update public.lots set head_hash = $2 where id = $1', [lot.id, original?.head_hash]);
    }
  });
});
