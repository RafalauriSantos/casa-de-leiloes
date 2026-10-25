import { randomUUID } from 'node:crypto';
import { settleLot } from '../../src/modules/settlement/service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import type { Config } from '../../src/config';
import { signUpUser, type TestUser } from '../helpers/auth';
import { recorded, startGithubStub, type GithubStub } from '../helpers/github-stub';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

// D21 option B, chosen by the owner: money never moves on a bid whose hash is not in the public anchor.
// A lot that ended waits (nobody is charged, nothing is credited) until the publisher has written its last
// bid; waiting is not a failure; bidding and reading go on. GitHub is the local stub that answers with
// recorded GitHub answers, the real publisher and the real settlement run unchanged.

let met: MetStub;
let github: GithubStub;
let server: TestServer;
let offServer: TestServer;
let auctioneer: TestUser;
/** Lots these tests made: unsettled ones are cancelled at the end, so the settlement of later tests does not retry them. */
const made: string[] = [];

beforeAll(async () => {
  met = await startMetStub();
  github = await startGithubStub({ fallback: true });
  const config: Config = { ...testConfig(), metApiUrl: met.baseUrl, anchor: { mode: 'github', repo: 'owner/anchor', token: 'test-token', apiUrl: github.baseUrl, branch: 'main' } };
  server = await startTestServer(config);
  offServer = await startTestServer({ ...testConfig(), metApiUrl: met.baseUrl, anchor: { mode: 'off' } });
  auctioneer = await createAuctioneer(server);
  // Other test files leave lots that ended and can never be settled (their history was altered on purpose). Every cron call
  // would count them as failures, so they are put aside: this file looks only at its own lots.
  await server.db.query("update public.lots set status = 'cancelled' where status = 'active' and settled_at is null and ends_at <= now()");
});
afterAll(async () => {
  await server.db.query("update public.lots set status = 'cancelled' where id = any($1::uuid[]) and settled_at is null", [made]);
  await offServer.close();
  await server.close();
  await github.close();
  await met.close();
});
beforeEach(async () => {
  github.reset();
  // The database is shared and keeps other tests' lots: leave them as published, so these runs meet only their own lots.
  await server.db.query('update public.lots set anchored_seq = head_seq where anchored_seq < head_seq and id <> all($1::uuid[])', [made]);
});

const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });
const fileOf = (lotId: string) => `lots/${lotId}.csv`;

async function bidder(base: TestServer = server): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${base.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: 1_000_000 }),
  });
  expect(deposit.status).toBe(201);
  return user;
}

interface Auction {
  lot: OwnLot;
  /** The bidders, in the order they bid; the last one leads. */
  bidders: TestUser[];
}

/** A live lot with one bid per amount, each from a new bidder. */
async function liveLotWithBids(amounts: number[], base: TestServer = server): Promise<Auction> {
  const created = await fetch(`${base.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(base), { startingBidCents: 50_000, incrementCents: 5_000 })) });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  made.push(lot.id);
  const now = await dbNow(base);
  await base.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [lot.id, new Date(now.getTime() - minutes(5)), new Date(now.getTime() + minutes(60))]);
  const bidders: TestUser[] = [];
  for (const amountCents of amounts) {
    const user = await bidder(base);
    const placed = await fetch(`${base.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
    expect(placed.status).toBe(201);
    bidders.push(user);
  }
  return { lot, bidders };
}

/** The lot's time has come, without anyone calling the cron. */
async function endLot(lotId: string): Promise<void> {
  const now = await dbNow(server);
  await server.db.query('update public.lots set ends_at = $2 where id = $1', [lotId, new Date(now.getTime() - 1_000)]);
}

async function ended(amounts: number[], base: TestServer = server): Promise<Auction> {
  const auction = await liveLotWithBids(amounts, base);
  await endLot(auction.lot.id);
  return auction;
}

interface Cron {
  status: number;
  body: { settled: number; failed: number; anchor: { mode: string; published: number; failed: number; stale: number } };
}
async function cron(): Promise<Cron> {
  const response = await fetch(`${server.url}/api/internal/close-due`, { method: 'POST', headers: { Authorization: `Bearer ${testConfig().cronSecret}` } });
  return { status: response.status, body: (await response.json()) as Cron['body'] };
}

const stateOf = async (lotId: string) =>
  (await server.db.query<{ settled_at: Date | null; outcome: string | null; anchored_seq: number; head_seq: number }>('select settled_at, outcome, anchored_seq, head_seq from public.lots where id = $1', [lotId]))[0];
const walletOf = async (user: TestUser) =>
  (await server.db.query<{ total_cents: number; committed_cents: number }>('select total_cents, committed_cents from public.wallets where user_id = $1', [user.id]))[0];
const countsOf = async (lotId: string) =>
  (await server.db.query<{ ledger: number; receipts: number }>(
    "select (select count(*)::int from public.wallet_ledger where lot_id = $1 and kind in ('lot_debit','lot_credit')) as ledger, (select count(*)::int from public.receipts where lot_id = $1) as receipts",
    [lotId],
  ))[0];

/** The first publication of a lot: the file is missing, the publisher creates it. */
async function scriptFirstPublication(lotId: string): Promise<void> {
  github.script(fileOf(lotId), [await recorded('get-missing'), await recorded('put-create')]);
}

describe('a lot whose last bid is not published yet waits: nobody is charged, nothing is credited', () => {
  it('is not settled when someone reads it, and the money stays where it was', async () => {
    const { lot, bidders } = await ended([50_000, 55_000]);
    const winner = bidders[1] as TestUser;
    const before = await walletOf(winner);

    const page = await fetch(`${server.url}/api/lots/${lot.id}`);
    const wallet = await fetch(`${server.url}/api/wallet`, { headers: json(winner) });

    expect(page.status).toBe(200);
    expect(wallet.status).toBe(200);
    expect((await stateOf(lot.id))?.settled_at).toBeNull();
    expect(await walletOf(winner)).toEqual(before);
    expect(await countsOf(lot.id)).toEqual({ ledger: 0, receipts: 0 });
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
  });

  it('is settled once the publisher has written its last bid: it waits one run, then pays', async () => {
    const { lot, bidders } = await ended([50_000, 55_000]);
    const winner = bidders[1] as TestUser;
    await scriptFirstPublication(lot.id);

    // The run settles first, so it finds the lot unpublished and waits; then it publishes.
    await cron();
    expect((await stateOf(lot.id))?.settled_at).toBeNull();
    expect(await stateOf(lot.id)).toMatchObject({ anchored_seq: 2, head_seq: 2 });

    const second = await cron();
    expect(second.body.settled).toBeGreaterThanOrEqual(1);
    expect(await stateOf(lot.id)).toMatchObject({ outcome: 'sold' });
    expect(await countsOf(lot.id)).toEqual({ ledger: 2, receipts: 1 });
    expect((await walletOf(winner))?.total_cents).toBe(1_000_000 - 55_000);
    expect((await walletOf(winner))?.committed_cents).toBe(0);
  });

  it('does not count waiting as a failure: the settlement counters stay clean', async () => {
    await ended([50_000]);

    const run = await cron();

    expect(run.body.failed).toBe(0);
  });
});

describe('waiting costs a read nothing: it does not lock the lot or check its chain', () => {
  /** Holds the lot's row lock in another transaction for the length of `during`, as a publisher or another settlement would. */
  async function whileLotIsLocked(lotId: string, during: () => Promise<void>): Promise<void> {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => {
      void server.db.tx(async (tx) => {
        await tx.query('select id from public.lots where id = $1 for update', [lotId]);
        resolve();
        await held;
      });
    });
    await locked;
    try {
      await during();
    } finally {
      release();
    }
  }
  const promptly = (request: Promise<Response>) =>
    Promise.race([request.then((response) => response.status), new Promise<string>((resolve) => setTimeout(() => { resolve('blocked'); }, 2_000))]);

  it('answers a read of a lot that waits for its publication while the lot is locked by someone else', async () => {
    const { lot } = await ended([50_000, 55_000]);

    await whileLotIsLocked(lot.id, async () => {
      expect(await promptly(fetch(`${server.url}/api/lots/${lot.id}`))).toBe(200);
    });
  });

  it('answers a read of a lot that was already settled while the lot is locked by someone else', async () => {
    const { lot } = await ended([50_000, 55_000]);
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    await fetch(`${server.url}/api/lots/${lot.id}`);
    expect((await stateOf(lot.id))?.outcome).toBe('sold');

    await whileLotIsLocked(lot.id, async () => {
      expect(await promptly(fetch(`${server.url}/api/lots/${lot.id}`))).toBe(200);
    });
  });

  it('answers a read of a lot that has not ended yet while the lot is locked by someone else: the most common read of all', async () => {
    // No bids, so nothing waits for a publication: only the lot not being over keeps this read from the lock.
    const { lot } = await liveLotWithBids([]);

    await whileLotIsLocked(lot.id, async () => {
      expect(await promptly(fetch(`${server.url}/api/lots/${lot.id}`))).toBe(200);
    });
  });

  it('says the settlement did nothing (false) while the lot waits, and true only when this call settled it', async () => {
    const { lot } = await ended([50_000, 55_000]);
    const config: Config = { ...testConfig(), metApiUrl: met.baseUrl, anchor: { mode: 'github', repo: 'owner/anchor', token: 'test-token', apiUrl: github.baseUrl, branch: 'main' } };

    expect(await settleLot(server.db, config, lot.id)).toBe(false);
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    expect(await settleLot(server.db, config, lot.id)).toBe(true);
    expect(await settleLot(server.db, config, lot.id)).toBe(false);
  });
});

describe('when GitHub is down', () => {
  it('keeps the lot waiting with the money untouched, run after run; the first run says it failed because the anchor failed', async () => {
    const { lot, bidders } = await ended([50_000, 55_000]);
    const winner = bidders[1] as TestUser;
    const before = await walletOf(winner);
    github.script(fileOf(lot.id), [{ status: 503, headers: {}, body: { message: 'down' } }]);

    const first = await cron();
    expect(first.status).toBe(500);
    expect(first.body.anchor.failed).toBeGreaterThanOrEqual(1);

    // The publisher waits a minute before it tries this lot again (D21), so the next runs do not call GitHub for it.
    // Whatever they answer, the lot is not paid and nothing moves.
    for (let run = 0; run < 2; run += 1) {
      await cron();
      expect((await stateOf(lot.id))?.settled_at).toBeNull();
      expect(await walletOf(winner)).toEqual(before);
      expect(await countsOf(lot.id)).toEqual({ ledger: 0, receipts: 0 });
    }
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(1);
  });

  it('does not stop bidding on a live lot: a bid is accepted while GitHub is down', async () => {
    const { lot } = await liveLotWithBids([50_000]);
    github.script(fileOf(lot.id), [{ status: 503, headers: {}, body: { message: 'down' } }]);
    const user = await bidder();

    const placed = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents: 55_000 }) });

    expect(placed.status).toBe(201);
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
  });
});

describe('many cron calls at once', () => {
  it('settle nothing while the lot waits, and exactly once when it is published', async () => {
    const { lot } = await ended([50_000, 55_000]);

    const whileWaiting = await Promise.all(Array.from({ length: 10 }, () => fetch(`${server.url}/api/lots/${lot.id}`)));
    expect(whileWaiting.every((response) => response.status === 200)).toBe(true);
    expect(await countsOf(lot.id)).toEqual({ ledger: 0, receipts: 0 });

    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    const together = await Promise.all(Array.from({ length: 10 }, () => cron()));

    expect(together.reduce((sum, run) => sum + run.body.settled, 0)).toBeGreaterThanOrEqual(1);
    expect(await countsOf(lot.id)).toEqual({ ledger: 2, receipts: 1 });
  }, 60_000);
});

describe('what is never paid, published or not', () => {
  it('never settles a lot whose history was altered, even when the lot says it was published', async () => {
    const { lot, bidders } = await ended([50_000, 55_000]);
    const winner = bidders[1] as TestUser;
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('update public.bids set amount_cents = 1 where lot_id = $1 and seq = 1', [lot.id]);
    });
    const before = await walletOf(winner);

    await cron();
    await cron();

    expect((await stateOf(lot.id))?.settled_at).toBeNull();
    expect(await walletOf(winner)).toEqual(before);
    expect(await countsOf(lot.id)).toEqual({ ledger: 0, receipts: 0 });
  });

  it('still reports a lot that is both altered and not published: the publisher refuses its history and the cron says it failed', async () => {
    const { lot, bidders } = await ended([50_000, 55_000]);
    const winner = bidders[1] as TestUser;
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('update public.bids set amount_cents = 1 where lot_id = $1 and seq = 1', [lot.id]);
    });
    const before = await walletOf(winner);
    // The settlement does not look at the chain of a lot that waits (a read of such a lot must stay cheap); the publisher does,
    // and refuses a history that does not verify, so the lot is never written to the anchor and the run is reported as failed.
    // The other altered lots of this file are put aside, so what the run reports is this lot's.
    await server.db.query("update public.lots set status = 'cancelled' where id <> $1 and status = 'active' and settled_at is null and ends_at <= now()", [lot.id]);

    const run = await cron();

    expect(run.status).toBe(500);
    expect(run.body.anchor.failed).toBe(1);
    expect(run.body.anchor.published).toBe(0);
    expect((await stateOf(lot.id))?.settled_at).toBeNull();
    expect(await walletOf(winner)).toEqual(before);
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
  });

  it('closes a lot with no bids without waiting for anything or calling GitHub', async () => {
    const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    const lot = (await created.json()) as OwnLot;
    made.push(lot.id);
    const now = await dbNow(server);
    await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [lot.id, new Date(now.getTime() - minutes(10)), new Date(now.getTime() - 1_000)]);

    await cron();

    expect(await stateOf(lot.id)).toMatchObject({ outcome: 'no_bids' });
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
  });
});

describe('with the anchor off (preview and local runs) there is nothing to wait for', () => {
  it('settles at once a lot whose bids were never published', async () => {
    const { lot, bidders } = await ended([50_000, 55_000], offServer);
    const winner = bidders[1] as TestUser;
    expect((await stateOf(lot.id))?.anchored_seq).toBe(0);

    const page = await fetch(`${offServer.url}/api/lots/${lot.id}`);

    expect(page.status).toBe(200);
    expect(await stateOf(lot.id)).toMatchObject({ outcome: 'sold' });
    expect((await walletOf(winner))?.total_cents).toBe(1_000_000 - 55_000);
  });
});
