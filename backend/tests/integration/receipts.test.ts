import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MyLot, OwnLot, ReceiptView } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';

// J6 (criteria 6.1 to 6.4): a bidder sees the lots they bid on and the lots they won, each won lot with its receipt;
// the receipt opens by its random code, without login, and names the winner by pseudonym only.

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

async function bidder(): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${server.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: 1_000_000 }),
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
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [lot.id, new Date(now.getTime() - minutes(5)), new Date(now.getTime() + minutes(60))]);
  return lot;
}

async function bid(lotId: string, user: TestUser, amountCents: number): Promise<void> {
  const response = await fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
  expect(response.status).toBe(201);
}

async function endLot(lotId: string): Promise<void> {
  const now = await dbNow(server);
  await server.db.query('update public.lots set ends_at = $2 where id = $1', [lotId, new Date(now.getTime() - 1_000)]);
}

const myLots = async (user: TestUser): Promise<MyLot[]> => {
  const response = await fetch(`${server.url}/api/me/wins`, { headers: json(user) });
  expect(response.status).toBe(200);
  return (await response.json()) as MyLot[];
};

/** A bidder who won one lot (settled when their list is read) and lost another to a second bidder. */
async function wonAndLost(): Promise<{ me: TestUser; other: TestUser; won: OwnLot; lost: OwnLot }> {
  const [won, lost, me, other] = [await liveLot(), await liveLot(), await bidder(), await bidder()];
  await bid(won.id, me, 50_000);
  await bid(lost.id, me, 50_000);
  await bid(lost.id, other, 55_000);
  await endLot(won.id);
  await endLot(lost.id);
  return { me, other, won, lost };
}

/** 101 cancelled lots (so no open lot is left behind), one bid by `bidderId` each, placed after `offsetSeconds`. */
async function bidCancelledLots(bidderId: TestUser, offsetSeconds: number): Promise<void> {
  await server.db.query(
    `with ids as (select g, gen_random_uuid() as id from generate_series(1, 101) as g),
     new_lots as (
       insert into public.lots (id, auctioneer_id, external_id, title, item_image_url, item_source_url, starts_at, ends_at,
                                starting_bid_cents, increment_cents, status)
       select id, $1, '1', 'Lote de limite ' || g, 'https://example.test/i.jpg', 'https://example.test/s', now() - interval '2 hours',
              now() - interval '1 hour', 50000, 5000, 'cancelled'
         from ids
       returning id
     )
     insert into public.bids (lot_id, seq, bidder_id, amount_cents, placed_at, prev_hash, hash)
     select id, 1, $2, 50000, now() - interval '2 hours' + ($3::int + g) * interval '1 second', repeat('a', 64), repeat('b', 64)
       from ids`,
    [auctioneer.id, bidderId.id, offsetSeconds],
  );
}

describe('my wins and the win receipt (J6)', () => {
  it('lists the lots a bidder bid on: a won lot with its receipt code, a lost one without (6.1)', async () => {
    const { me, won, lost } = await wonAndLost();
    const lots = await myLots(me);
    expect(lots.find((lot) => lot.lotId === won.id)).toMatchObject({ outcome: 'won', amountCents: 50_000, myBestCents: 50_000 });
    expect(lots.find((lot) => lot.lotId === won.id)?.receiptCode).toMatch(/^[0-9a-f]{32}$/);
    expect(lots.find((lot) => lot.lotId === lost.id)).toMatchObject({ outcome: 'lost', receiptCode: null, myBestCents: 50_000 });
  });

  it('shows the highest amount the bidder offered, not the first one', async () => {
    const lot = await liveLot();
    const [me, other] = [await bidder(), await bidder()];
    await bid(lot.id, me, 50_000);
    await bid(lot.id, other, 55_000);
    await bid(lot.id, me, 60_000);
    const mine = (await myLots(me)).find((item) => item.lotId === lot.id);
    expect(mine).toMatchObject({ outcome: 'leading', myBestCents: 60_000, amountCents: 60_000 });
  });

  it('opens the receipt by its code without login, naming the winner by pseudonym only (6.2, 6.3)', async () => {
    const { me, won } = await wonAndLost();
    const code = (await myLots(me)).find((lot) => lot.lotId === won.id)?.receiptCode;
    const response = await fetch(`${server.url}/api/receipts/${String(code)}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    const receipt = JSON.parse(text) as ReceiptView;
    expect(receipt).toMatchObject({ code, lotId: won.id, amountCents: 50_000 });
    expect(text).not.toContain(me.id);
    expect(text).not.toContain(me.email);
    // The winner's label is the same pseudonym the public audit shows for their last bid, so the two cannot drift.
    const audit = (await (await fetch(`${server.url}/api/lots/${won.id}/audit`)).json()) as { bids: Array<{ bidderLabel: string }> };
    expect(receipt.winnerLabel).toBe(audit.bids.at(-1)?.bidderLabel);
    expect(text).not.toContain(me.id.slice(0, 8));
  });

  it('lists at most 100 lots, newest bid first, and never more than the limit', async () => {
    const me = await bidder();
    await bidCancelledLots(me, 0);
    const titles = (await myLots(me)).map((lot) => lot.title);
    expect(titles).toHaveLength(100);
    // The newest bid comes first, and the oldest one falls outside the limit.
    expect(titles[0]).toBe('Lote de limite 101');
    expect(titles.at(-1)).toBe('Lote de limite 2');
    expect(titles).not.toContain('Lote de limite 1');
  });

  it('lists the won lots first, even when 100 newer bids follow the win', async () => {
    const { me, won } = await wonAndLost();
    // The filler bids come after the win: 2 hours (the helper's base) plus 60 seconds puts them just after now.
    await bidCancelledLots(me, 2 * 60 * 60 + 60);
    const lots = await myLots(me);
    expect(lots[0]).toMatchObject({ lotId: won.id, outcome: 'won' });
    expect(lots[0]?.receiptCode).toMatch(/^[0-9a-f]{32}$/);
  });

  it('shows a lot that cannot settle yet as settling, never as won (a tampered history is held back)', async () => {
    const lot = await liveLot();
    const [me, other] = [await bidder(), await bidder()];
    await bid(lot.id, other, 50_000);
    await bid(lot.id, me, 55_000);
    await endLot(lot.id);
    // Someone with direct database access changes the last bid: the history no longer verifies, so no receipt is written.
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('update public.bids set amount_cents = 1 where lot_id = $1 and seq = 2', [lot.id]);
    });
    try {
      const mine = (await myLots(me)).find((item) => item.lotId === lot.id);
      expect(mine).toMatchObject({ outcome: 'settling', receiptCode: null });
    } finally {
      // The tampered lot would fail every later settlement run in the shared database: cancel it, as the other tests do.
      await server.db.query("update public.lots set status = 'cancelled' where id = $1", [lot.id]);
    }
  });

  it('keeps a receipt behind its code and a list with its owner (6.4)', async () => {
    const { me, other, won, lost } = await wonAndLost();
    for (const code of [randomBytes(16).toString('hex'), 'not-a-code']) {
      const response = await fetch(`${server.url}/api/receipts/${code}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'not_found' });
    }
    expect((await fetch(`${server.url}/api/me/wins`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/me/wins`, { headers: json(auctioneer) })).status).toBe(403);
    await myLots(me);
    // The other bidder's read settles the lot they won: its receipt is theirs, never listed as mine.
    const theirs = await myLots(other);
    expect(theirs.find((lot) => lot.lotId === won.id)).toBeUndefined();
    expect(theirs.find((lot) => lot.lotId === lost.id)?.outcome).toBe('won');
    expect((await myLots(me)).find((lot) => lot.lotId === lost.id)).toMatchObject({ outcome: 'lost', receiptCode: null });
  });
});
