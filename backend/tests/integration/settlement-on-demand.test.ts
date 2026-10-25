import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';

// D6: a due lot is settled when someone reads it, bids on it or reads the wallet of its leader,
// so correctness does not wait for the cron. These tests never call the cron route.

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

async function bid(lotId: string, user: TestUser, amountCents: number): Promise<void> {
  const response = await fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
  expect(response.status).toBe(201);
}

/** Moves the lot's end into the past, as if its time had come, without anyone calling the cron. */
async function endLot(lotId: string): Promise<void> {
  const now = await dbNow(server);
  await server.db.query('update public.lots set ends_at = $2 where id = $1', [lotId, new Date(now.getTime() - 1_000)]);
}

async function settledAt(lotId: string): Promise<Date | null> {
  const [row] = await server.db.query<{ settled_at: Date | null }>('select settled_at from public.lots where id = $1', [lotId]);
  if (!row) throw new Error('lot missing');
  return row.settled_at;
}

describe('a failed on-demand settlement does not fail the reader and moves no money', () => {
  it('still answers the read and the bid, keeps the money committed, and leaves the lot unsettled', async () => {
    const lot = await liveLot();
    const winner = await bidder();
    await bid(lot.id, winner, 50_000);
    await endLot(lot.id);
    const [original] = await server.db.query<{ head_hash: string }>('select head_hash from public.lots where id = $1', [lot.id]);
    await server.db.query("update public.lots set head_hash = repeat('0', 64) where id = $1", [lot.id]);

    try {
      const read = await fetch(`${server.url}/api/lots/${lot.id}`);
      expect(read.status).toBe(200);

      const late = await fetch(`${server.url}/api/lots/${lot.id}/bids`, {
        method: 'POST',
        headers: json(await bidder()),
        body: JSON.stringify({ amountCents: 60_000 }),
      });
      expect(late.status).toBe(409);

      const wallet = await fetch(`${server.url}/api/wallet`, { headers: json(winner) });
      const body = (await wallet.json()) as { committedCents: number };
      expect(wallet.status).toBe(200);
      expect(body.committedCents).toBe(50_000);
      expect(await settledAt(lot.id)).toBeNull();
    } finally {
      await server.db.query('update public.lots set head_hash = $2 where id = $1', [lot.id, original?.head_hash]);
    }
  });
});

describe('a lot whose history or head copy was altered is never settled and moves no money', () => {
  async function committed(user: TestUser): Promise<number> {
    const [wallet] = await server.db.query<{ committed_cents: number }>('select committed_cents from public.wallets where user_id = $1', [user.id]);
    return wallet?.committed_cents ?? Number.NaN;
  }

  it('refuses a lot whose earlier bid was edited in the database', async () => {
    const lot = await liveLot();
    const first = await bidder();
    const winner = await bidder();
    await bid(lot.id, first, 50_000);
    await bid(lot.id, winner, 55_000);
    await endLot(lot.id);
    // The edited bid is not the last one, so the leader and amount of the lot still match: only the chain check can see it.
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('update public.bids set amount_cents = 1 where lot_id = $1 and seq = 1', [lot.id]);
    });

    expect((await fetch(`${server.url}/api/lots/${lot.id}`)).status).toBe(200);
    const wallet = await fetch(`${server.url}/api/wallet`, { headers: json(winner) });
    expect(wallet.status).toBe(200);

    expect(await settledAt(lot.id)).toBeNull();
    expect(await committed(winner)).toBe(55_000);
  });

  it('refuses a lot whose earlier bid time was changed by a microsecond', async () => {
    const lot = await liveLot();
    const first = await bidder();
    const winner = await bidder();
    await bid(lot.id, first, 50_000);
    await bid(lot.id, winner, 55_000);
    await endLot(lot.id);
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query("update public.bids set placed_at = placed_at + interval '1 microsecond' where lot_id = $1 and seq = 1", [lot.id]);
    });

    expect((await fetch(`${server.url}/api/lots/${lot.id}`)).status).toBe(200);
    expect((await fetch(`${server.url}/api/wallet`, { headers: json(winner) })).status).toBe(200);

    expect(await settledAt(lot.id)).toBeNull();
    expect(await committed(winner)).toBe(55_000);
  });

  it('refuses a lot whose head_seq was rewritten to a state the history does not reach', async () => {
    const lot = await liveLot();
    const winner = await bidder();
    await bid(lot.id, winner, 50_000);
    await endLot(lot.id);
    await server.db.query('update public.lots set head_seq = 2 where id = $1', [lot.id]);

    expect((await fetch(`${server.url}/api/lots/${lot.id}`)).status).toBe(200);
    expect((await fetch(`${server.url}/api/wallet`, { headers: json(winner) })).status).toBe(200);

    expect(await settledAt(lot.id)).toBeNull();
    expect(await committed(winner)).toBe(50_000);
  });
});

describe('a due lot is settled when someone reads it, without the cron', () => {
  it('settles the lot when its public page is read', async () => {
    const lot = await liveLot();
    await bid(lot.id, await bidder(), 50_000);
    await endLot(lot.id);

    const response = await fetch(`${server.url}/api/lots/${lot.id}`);

    expect(response.status).toBe(200);
    expect(await settledAt(lot.id)).not.toBeNull();
  });

  it('settles the lot when a bid arrives after its end, and refuses that bid as ended', async () => {
    const lot = await liveLot();
    await bid(lot.id, await bidder(), 50_000);
    await endLot(lot.id);
    const late = await bidder();

    const response = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(late), body: JSON.stringify({ amountCents: 60_000 }) });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('lot_ended');
    expect(await settledAt(lot.id)).not.toBeNull();
  });

  it('settles the lots a wallet leads when the wallet is read, so the committed money is released', async () => {
    const lot = await liveLot();
    const winner = await bidder();
    await bid(lot.id, winner, 50_000);
    await endLot(lot.id);
    const [before] = await server.db.query<{ total_cents: number; committed_cents: number }>(
      'select total_cents, committed_cents from public.wallets where user_id = $1',
      [winner.id],
    );

    const response = await fetch(`${server.url}/api/wallet`, { headers: json(winner) });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { totalCents: number; committedCents: number };
    expect(body.committedCents).toBe(0);
    expect(body.totalCents).toBe(before ? before.total_cents - 50_000 : Number.NaN);
    expect(await settledAt(lot.id)).not.toBeNull();
  });
});
