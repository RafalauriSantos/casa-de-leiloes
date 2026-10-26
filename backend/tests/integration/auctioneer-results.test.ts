import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuctioneerSummary, OwnLot } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';

// B3 (criterion 1.7): the auctioneer sees the result of each ended lot (sold for how much, or no bids, or still waiting
// for its settlement) and the total they received, and nothing of other auctioneers' lots.

let server: TestServer;
let met: MetStub;

beforeAll(async () => {
  met = await startMetStub();
  server = await startTestServer({ metApiUrl: met.baseUrl });
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

async function lotFor(owner: TestUser, window: { startsAgo: number; endsAhead: number }): Promise<OwnLot> {
  const created = await fetch(`${server.url}/api/lots`, {
    method: 'POST',
    headers: json(owner),
    body: JSON.stringify(lotBody(await dbNow(server), { startingBidCents: 50_000, incrementCents: 5_000 })),
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [
    lot.id,
    new Date(now.getTime() - minutes(window.startsAgo)),
    new Date(now.getTime() + minutes(window.endsAhead)),
  ]);
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

/** Reading a lot settles it when its time is over (D6), so the result is final. */
const settleByReading = (lotId: string) => fetch(`${server.url}/api/lots/${lotId}`);

const myLots = async (owner: TestUser): Promise<OwnLot[]> => {
  const response = await fetch(`${server.url}/api/auctioneer/lots`, { headers: json(owner) });
  expect(response.status).toBe(200);
  return (await response.json()) as OwnLot[];
};

const summary = async (owner: TestUser): Promise<AuctioneerSummary> => {
  const response = await fetch(`${server.url}/api/auctioneer/summary`, { headers: json(owner) });
  expect(response.status).toBe(200);
  return (await response.json()) as AuctioneerSummary;
};

describe('the auctioneer sees the results of their lots (B3, 1.7)', () => {
  it('shows a sold lot with its amount, a lot with no bids as such, and a running lot with no result', async () => {
    const owner = await createAuctioneer(server);
    const running = await lotFor(owner, { startsAgo: 5, endsAhead: 60 });
    const sold = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    const empty = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    const buyer = await bidder();
    await bid(sold.id, buyer, 55_000);
    await endLot(sold.id);
    await endLot(empty.id);
    await settleByReading(sold.id);
    await settleByReading(empty.id);

    const lots = await myLots(owner);
    expect(lots.find((lot) => lot.id === sold.id)?.result).toEqual({ outcome: 'sold', amountCents: 55_000 });
    expect(lots.find((lot) => lot.id === empty.id)?.result).toEqual({ outcome: 'no_bids', amountCents: null });
    expect(lots.find((lot) => lot.id === running.id)?.result).toBeNull();
  });

  it('shows an ended lot with bids as pending until its settlement is done, never as sold', async () => {
    const owner = await createAuctioneer(server);
    const lot = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    await bid(lot.id, await bidder(), 55_000);
    await endLot(lot.id);

    expect((await myLots(owner)).find((item) => item.id === lot.id)?.result).toEqual({ outcome: 'pending', amountCents: null });
    await settleByReading(lot.id);
    expect((await myLots(owner)).find((item) => item.id === lot.id)?.result).toEqual({ outcome: 'sold', amountCents: 55_000 });
  });

  it('totals what this auctioneer received, counts ended lots, and leaves other auctioneers out', async () => {
    const owner = await createAuctioneer(server);
    const other = await createAuctioneer(server);
    const first = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    const second = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    const unsold = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    const pending = await lotFor(owner, { startsAgo: 60, endsAhead: 60 });
    const stranger = await lotFor(other, { startsAgo: 60, endsAhead: 60 });
    await bid(first.id, await bidder(), 55_000);
    await bid(second.id, await bidder(), 60_000);
    await bid(pending.id, await bidder(), 70_000);
    await bid(stranger.id, await bidder(), 99_000);
    for (const lot of [first, second, unsold, pending, stranger]) await endLot(lot.id);
    // The pending lot is ended with bids but not settled yet: it adds to neither the total nor the sold count.
    for (const lot of [first, second, unsold, stranger]) await settleByReading(lot.id);

    expect(await summary(owner)).toEqual({ totalReceivedCents: 115_000, soldLots: 2, endedLots: 3 });
  });

  it('refuses the results to a bidder', async () => {
    const buyer = await bidder();
    expect((await fetch(`${server.url}/api/auctioneer/summary`, { headers: json(buyer) })).status).toBe(403);
    expect((await fetch(`${server.url}/api/auctioneer/lots`, { headers: json(buyer) })).status).toBe(403);
  });
});
