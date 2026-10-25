import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditReport, LiveLot, OwnLot } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';

// D22, slice 2: the public audit route without the anchor. It is read-only and public, shows the bids with
// pseudonyms, and reports the chain: intact, or tampered at the first seq where history and head copy disagree.

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
  const user = await signUpUser({ displayName: `Nome Real ${randomUUID().slice(0, 6)}` });
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

/** A live lot with three bids by two bidders: 50,000, 55,000, 60,000. */
async function lotWithThreeBids(): Promise<{ lot: OwnLot; first: TestUser; second: TestUser }> {
  const lot = await liveLot();
  const first = await bidder();
  const second = await bidder();
  await bid(lot.id, first, 50_000);
  await bid(lot.id, second, 55_000);
  await bid(lot.id, first, 60_000);
  return { lot, first, second };
}

const audit = (lotId: string, query = '') => fetch(`${server.url}/api/lots/${lotId}/audit${query}`);

/** What someone with full database access can do: the trigger that keeps the bids append-only is skipped for one transaction. */
async function asDatabaseWriter(statements: { text: string; params?: unknown[] }[]): Promise<void> {
  await server.db.tx(async (tx) => {
    await tx.query('set local session_replication_role = replica');
    for (const statement of statements) await tx.query(statement.text, statement.params);
  });
}

describe('GET /api/lots/:id/audit shows the history of an intact lot', () => {
  it('is public, lists every bid oldest first with its hash, and says the chain is intact', async () => {
    const { lot } = await lotWithThreeBids();

    const response = await audit(lot.id);

    expect(response.status).toBe(200);
    const report = (await response.json()) as AuditReport;
    expect(report.lotId).toBe(lot.id);
    expect(report.chain).toEqual({ status: 'intact' });
    expect(report.bids.map((b) => [b.seq, b.amountCents])).toEqual([[1, 50_000], [2, 55_000], [3, 60_000]]);
    const stored = await server.db.query<{ seq: number; hash: string }>('select seq, hash from public.bids where lot_id = $1 order by seq', [lot.id]);
    expect(report.bids.map((b) => b.hash)).toEqual(stored.map((row) => row.hash));
  });

  it('truncates every time to the second', async () => {
    const { lot } = await lotWithThreeBids();

    const report = (await (await audit(lot.id)).json()) as AuditReport;

    for (const entry of report.bids) expect(entry.placedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('shows the same pseudonym as the live room, and the same bidder keeps one label inside the lot', async () => {
    const { lot } = await lotWithThreeBids();

    const report = (await (await audit(lot.id)).json()) as AuditReport;
    const room = (await (await fetch(`${server.url}/api/lots/${lot.id}/live`)).json()) as LiveLot;

    const label = (seq: number) => report.bids.find((b) => b.seq === seq)?.bidderLabel;
    expect(label(1)).toBe(label(3));
    expect(label(1)).not.toBe(label(2));
    for (const entry of room.history) expect(label(entry.seq)).toBe(entry.bidderLabel);
  });

  it('exposes no name, e-mail, user id or secret', async () => {
    const { lot, first, second } = await lotWithThreeBids();

    const text = await (await audit(lot.id)).text();

    for (const secret of [first.id, second.id, first.email, second.email, 'Nome Real', process.env['AUDIT_HMAC_SECRET'] ?? 'unset-secret']) expect(text).not.toContain(secret);
    expect(Object.keys((JSON.parse(text) as AuditReport).bids[0] ?? {}).sort()).toEqual(['amountCents', 'bidderLabel', 'hash', 'placedAt', 'seq']);
  });

  it('answers a lot with no bids as intact and empty, including a cancelled one', async () => {
    const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    const lot = (await created.json()) as OwnLot;
    const cancelled = await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: json(auctioneer) });
    expect(cancelled.status).toBe(200);

    const response = await audit(lot.id);

    expect(response.status).toBe(200);
    expect((await response.json()) as AuditReport).toEqual({ lotId: lot.id, bids: [], chain: { status: 'intact' }, anchor: { status: 'off' }, headline: { kind: 'no_bids', anchorUnverified: true } });
  });

  it('never settles and never writes: an ended lot stays unsettled after being audited', async () => {
    const { lot } = await lotWithThreeBids();
    await server.db.query('update public.lots set ends_at = $2 where id = $1', [lot.id, new Date((await dbNow(server)).getTime() - 1_000)]);

    const response = await audit(lot.id);

    expect(response.status).toBe(200);
    const [row] = await server.db.query<{ settled_at: Date | null }>('select settled_at from public.lots where id = $1', [lot.id]);
    expect(row?.settled_at).toBeNull();
  });
});

describe('the headline and the receipt head, with the anchor off', () => {
  const hashOf = async (lotId: string, seq: number) => (await server.db.query<{ hash: string }>('select hash from public.bids where lot_id = $1 and seq = $2', [lotId, seq]))[0]?.hash ?? '';

  it('says only that the anchor was not verified for an intact lot, and finds a receipt head without upgrading the headline', async () => {
    const { lot } = await lotWithThreeBids();

    const plain = (await (await audit(lot.id)).json()) as AuditReport;
    const withHead = (await (await audit(lot.id, `?head=${await hashOf(lot.id, 2)}`)).json()) as AuditReport;

    expect(plain.headline).toEqual({ kind: 'anchor_unverified' });
    expect(plain.receiptHead).toBeUndefined();
    expect(withHead.receiptHead).toEqual({ status: 'in_history', seq: 2 });
    expect(withHead.headline).toEqual({ kind: 'anchor_unverified' });
  });

  it('says unconfirmed, not tampered, for a head that is not in the history, and for a made-up one', async () => {
    const { lot } = await lotWithThreeBids();

    const report = (await (await audit(lot.id, `?head=${'a'.repeat(64)}`)).json()) as AuditReport;

    expect(report.receiptHead).toEqual({ status: 'not_in_history' });
    expect(report.chain).toEqual({ status: 'intact' });
    expect(report.headline).toEqual({ kind: 'unconfirmed' });
  });

  it('says unconfirmed for the receipt of a last bid that was removed and the head rewritten (the window the anchor cannot see)', async () => {
    const { lot } = await lotWithThreeBids();
    const kept = await hashOf(lot.id, 3);
    await asDatabaseWriter([
      { text: 'delete from public.bids where lot_id = $1 and seq = 3', params: [lot.id] },
      { text: 'update public.lots set head_seq = 2, bid_count = 2, head_hash = (select hash from public.bids where lot_id = $1 and seq = 2) where id = $1', params: [lot.id] },
    ]);

    const report = (await (await audit(lot.id, `?head=${kept}`)).json()) as AuditReport;

    expect(report.chain).toEqual({ status: 'intact' });
    expect(report.headline).toEqual({ kind: 'unconfirmed' });
  });

  it('says tampered for a tampered chain whatever head is sent, and for a lot with no bids says there are no bids', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([{ text: 'update public.bids set amount_cents = 1 where lot_id = $1 and seq = 2', params: [lot.id] }]);
    for (const head of [await hashOf(lot.id, 1), 'a'.repeat(64)]) {
      expect(((await (await audit(lot.id, `?head=${head}`)).json()) as AuditReport).headline).toEqual({ kind: 'tampered' });
    }

    const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    const empty = (await created.json()) as OwnLot;
    expect(((await (await audit(empty.id)).json()) as AuditReport).headline).toEqual({ kind: 'no_bids', anchorUnverified: true });
  });
});

describe('GET /api/lots/:id/audit refusals', () => {
  it('answers 404 not_found for a lot that does not exist and for an id that is not a uuid', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      const response = await audit(id);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe('not_found');
    }
  });

  it('answers 422 validation_error for a head that is not 64 lowercase hex characters, before looking at the lot', async () => {
    const bad = ['abc', 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}0`];
    for (const head of bad) {
      const response = await audit(randomUUID(), `?head=${head}`);
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe('validation_error');
    }
  });

  it('accepts a well-formed head', async () => {
    const { lot } = await lotWithThreeBids();

    expect((await audit(lot.id, `?head=${'a'.repeat(64)}`)).status).toBe(200);
  });
});

describe('the chain result names the first broken seq when the database is altered directly', () => {
  const tampered = async (lotId: string) => ((await (await audit(lotId)).json()) as AuditReport).chain;

  it('names an edited amount, bidder and time', async () => {
    const other = await bidder();

    const amount = await lotWithThreeBids();
    await asDatabaseWriter([{ text: 'update public.bids set amount_cents = 1 where lot_id = $1 and seq = 2', params: [amount.lot.id] }]);
    expect(await tampered(amount.lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 2 });

    const author = await lotWithThreeBids();
    await asDatabaseWriter([{ text: 'update public.bids set bidder_id = $2 where lot_id = $1 and seq = 3', params: [author.lot.id, other.id] }]);
    expect(await tampered(author.lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 3 });

    const time = await lotWithThreeBids();
    await asDatabaseWriter([{ text: "update public.bids set placed_at = placed_at + interval '1 millisecond' where lot_id = $1 and seq = 1", params: [time.lot.id] }]);
    expect(await tampered(time.lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 1 });
  });

  it('names a change of a single microsecond in the stored time, finer than the millisecond a Date holds', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([{ text: "update public.bids set placed_at = placed_at + interval '1 microsecond' where lot_id = $1 and seq = 2", params: [lot.id] }]);

    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 2 });
  });

  it('names the seq expected where a bid was removed from the middle', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([{ text: 'delete from public.bids where lot_id = $1 and seq = 2', params: [lot.id] }]);

    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 2 });
  });

  it('names the head_seq when the last bid was removed and the lot still says it exists', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([{ text: 'delete from public.bids where lot_id = $1 and seq = 3', params: [lot.id] }]);

    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 3 });
  });

  it('names a forged bid added at the end', async () => {
    const { lot, first } = await lotWithThreeBids();
    await asDatabaseWriter([
      {
        text: `insert into public.bids (lot_id, seq, bidder_id, amount_cents, placed_at, prev_hash, hash) values ($1, 4, $2, 99999, now(), repeat('0', 64), repeat('1', 64))`,
        params: [lot.id, first.id],
      },
    ]);

    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 4 });
  });

  it('names two bids whose order was swapped', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([
      { text: 'update public.bids set seq = 20 where lot_id = $1 and seq = 2', params: [lot.id] },
      { text: 'update public.bids set seq = 2 where lot_id = $1 and seq = 3', params: [lot.id] },
      { text: 'update public.bids set seq = 3 where lot_id = $1 and seq = 20', params: [lot.id] },
    ]);

    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 2 });
  });

  it('names the lot head copy rewritten without touching the bids', async () => {
    const { lot } = await lotWithThreeBids();

    await asDatabaseWriter([{ text: "update public.lots set head_hash = repeat('f', 64) where id = $1", params: [lot.id] }]);
    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 3 });

    await asDatabaseWriter([{ text: 'update public.lots set head_seq = 1 where id = $1', params: [lot.id] }]);
    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 2 });
  });

  it('names bid 1 when every bid was deleted and the lot still has a head', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([{ text: 'delete from public.bids where lot_id = $1', params: [lot.id] }]);

    expect(await tampered(lot.id)).toEqual({ status: 'tampered', brokenAtSeq: 1 });
  });

  it('audits a cancelled lot that has bids like any other, so the status cannot hide tampering', async () => {
    const { lot } = await lotWithThreeBids();
    await asDatabaseWriter([
      { text: "update public.lots set status = 'cancelled' where id = $1", params: [lot.id] },
      { text: 'delete from public.bids where lot_id = $1 and seq = 2', params: [lot.id] },
    ]);

    const response = await audit(lot.id);

    expect(response.status).toBe(200);
    expect(((await response.json()) as AuditReport).chain).toEqual({ status: 'tampered', brokenAtSeq: 2 });
  });
});

describe('the audit never shows a false alarm while bids arrive (one consistent snapshot of the lot and its bids)', () => {
  it('reports every read as intact while bidders place bids in parallel', async () => {
    const lot = await liveLot();
    const bidders = await Promise.all(Array.from({ length: 6 }, bidder));
    const reading = { on: true };
    const reports: AuditReport[] = [];
    const reader = (async () => {
      while (reading.on) reports.push((await (await audit(lot.id)).json()) as AuditReport);
    })();

    for (let round = 0; round < 8; round += 1) {
      const base = 50_000 + round * 6 * 5_000;
      // Each round raises the price once per bidder, one after another; the reader keeps asking in parallel.
      for (const [index, user] of bidders.entries()) {
        const response = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents: base + index * 5_000 }) });
        expect(response.status).toBe(201);
      }
    }
    reading.on = false;
    await reader;

    expect(reports.length).toBeGreaterThan(5);
    expect(reports.filter((r) => r.chain.status !== 'intact')).toEqual([]);
    expect(((await (await audit(lot.id)).json()) as AuditReport).bids).toHaveLength(48);
  });
});
