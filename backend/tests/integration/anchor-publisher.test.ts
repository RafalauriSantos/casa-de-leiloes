import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import type { Config } from '../../src/config';
import { ANCHOR_HEADER, ANCHOR_LAST_START_MS, publishPending } from '../../src/modules/anchor';
import { DEFAULT_TIMEOUT_MS } from '../../src/modules/anchor/github-client';
import { RUN_BUDGET_MS } from '../../src/modules/anchor/service';
import { signUpUser, type TestUser } from '../helpers/auth';
import { recorded, startGithubStub, type GithubStub } from '../helpers/github-stub';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

// The publisher (D21) on real Postgres and real HTTP, against real GitHub answers recorded from a scratch
// repository, with the identifiers replaced (helpers/github-stub.ts). Each test uses its own lot and looks at the requests of its own file.

let met: MetStub;
let github: GithubStub;
let server: TestServer;
let config: Config;
let auctioneer: TestUser;

beforeAll(async () => {
  met = await startMetStub();
  github = await startGithubStub({ fallback: true });
  config = { ...testConfig(), metApiUrl: met.baseUrl, anchor: { mode: 'github', repo: 'owner/anchor', token: 'test-token', apiUrl: github.baseUrl, branch: 'main' } };
  server = await startTestServer(config);
  auctioneer = await createAuctioneer(server);
  // The database is shared and keeps old lots. Only lots made from now on are pending.
  await server.db.query('update public.lots set anchored_seq = head_seq where anchored_seq < head_seq');
});
afterAll(async () => {
  await server.close();
  await github.close();
  await met.close();
});
beforeEach(() => {
  github.reset();
});

const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });
const b64 = (text: string) => Buffer.from(text).toString('base64');
const fileOf = (lotId: string) => `lots/${lotId}.csv`;

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

/** A live lot, with one bid for each amount given, each from a new bidder. */
async function lotWithBids(amounts: number[]): Promise<OwnLot> {
  const created = await fetch(`${server.url}/api/lots`, {
    method: 'POST',
    headers: json(auctioneer),
    body: JSON.stringify(lotBody(await dbNow(server), { startingBidCents: 50_000, incrementCents: 5_000 })),
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [lot.id, new Date(now.getTime() - minutes(5)), new Date(now.getTime() + minutes(60))]);
  for (const amountCents of amounts) await bidOn(lot.id, amountCents);
  return lot;
}

async function bidOn(lotId: string, amountCents: number): Promise<void> {
  const response = await fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(await bidder()), body: JSON.stringify({ amountCents }) });
  expect(response.status).toBe(201);
}

interface Cron {
  status: number;
  body: { settled: number; failed: number; anchor: { mode: string; published: number; failed: number; stale: number } };
}

async function cron(url = server.url): Promise<Cron> {
  const response = await fetch(`${url}/api/internal/close-due`, { method: 'POST', headers: { Authorization: `Bearer ${testConfig().cronSecret}` } });
  return { status: response.status, body: (await response.json()) as Cron['body'] };
}

const bidsOf = (lotId: string) => server.db.query<{ seq: number; hash: string }>('select seq, hash from public.bids where lot_id = $1 order by seq', [lotId]);

async function progressOf(lotId: string) {
  const [row] = await server.db.query<{ anchored_seq: number; anchor_attempts: number; seconds_to_retry: number | null }>(
    'select anchored_seq, anchor_attempts, extract(epoch from (anchor_retry_at - clock_timestamp()))::float as seconds_to_retry from public.lots where id = $1',
    [lotId],
  );
  if (!row) throw new Error('lot missing');
  return row;
}

/** What a published file holds for these bids: the header, then one line per bid. */
const fileText = (lotId: string, rows: { seq: number; hash: string }[]) =>
  `${ANCHOR_HEADER}\n${rows.map((row) => `${lotId},${String(row.seq)},${row.hash},2026-10-24T20:00:00.000Z`).join('\n')}\n`;

/** Leaves every lot but these as published, so a run meets only them (the database is shared with other test files). */
const only = (...lots: OwnLot[]) => server.db.query('update public.lots set anchored_seq = head_seq where id <> all($1::uuid[])', [lots.map((lot) => lot.id)]);

/** A lot with bids that is already published, and the stub forgotten, ready for the next bid. */
async function publishedLot(amounts: number[]): Promise<OwnLot> {
  const lot = await lotWithBids(amounts);
  github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('put-create')]);
  await cron();
  github.reset();
  return lot;
}

const writtenContent = (lotId: string, index = 0) => Buffer.from(String(github.requestsFor(fileOf(lotId)).filter((r) => r.method === 'PUT')[index]?.body?.content), 'base64').toString('utf8');

describe('the publisher writes the bid hashes of a lot to the anchor', () => {
  it('creates the file of a new lot with its header and one line per bid, then records the progress', async () => {
    const lot = await lotWithBids([50_000, 55_000]);
    github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('put-create')]);

    const result = await cron();

    expect(result.body.anchor.mode).toBe('github');
    const requests = github.requestsFor(fileOf(lot.id));
    expect(requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(requests[1]?.body).not.toHaveProperty('sha');
    const rows = await bidsOf(lot.id);
    const lines = writtenContent(lot.id).trimEnd().split('\n');
    expect(lines[0]).toBe(ANCHOR_HEADER);
    expect(lines).toHaveLength(3);
    rows.forEach((row, index) => {
      const [lotId, seq, hash, publishedAt] = (lines[index + 1] ?? '').split(',');
      expect([lotId, seq, hash]).toEqual([lot.id, String(row.seq), row.hash]);
      expect(Number.isNaN(Date.parse(publishedAt ?? ''))).toBe(false);
    });
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 2, anchor_attempts: 0, seconds_to_retry: null });
  });

  it('appends only the new bids to a file that exists, sending the sha it read', async () => {
    const lot = await lotWithBids([50_000]);
    github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('put-create')]);
    await cron();
    await bidOn(lot.id, 55_000);
    const rows = await bidsOf(lot.id);
    const before = fileText(lot.id, rows.slice(0, 1));
    github.reset();
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(before), sha: 'sha-of-the-file' }), await recorded('put-update-ok')]);

    await cron();

    const put = github.requestsFor(fileOf(lot.id)).find((r) => r.method === 'PUT');
    expect(put?.body?.sha).toBe('sha-of-the-file');
    const written = writtenContent(lot.id);
    expect(written.startsWith(before)).toBe(true);
    const added = written.slice(before.length).trimEnd().split('\n');
    expect(added).toHaveLength(1);
    expect(added[0]?.startsWith(`${lot.id},2,${rows[1]?.hash ?? ''},`)).toBe(true);
    expect((await progressOf(lot.id)).anchored_seq).toBe(2);
  });

  it('does nothing for a lot whose hashes are all published', async () => {
    const lot = await lotWithBids([50_000]);
    github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('put-create')]);
    await cron();
    github.reset();

    await cron();

    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
  });

  it('resumes after a crash: lines already in the file are not written again', async () => {
    const lot = await lotWithBids([50_000, 55_000]);
    const rows = await bidsOf(lot.id);
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(fileText(lot.id, rows)), sha: 'sha-of-the-file' })]);

    await cron();

    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 2, anchor_attempts: 0 });
  });

  it('refuses to bless a different hash: the anchor holds another value for a bid', async () => {
    const lot = await lotWithBids([50_000]);
    const rows = await bidsOf(lot.id);
    const wrong = fileText(lot.id, rows.map((row) => ({ seq: row.seq, hash: 'f'.repeat(64) })));
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(wrong), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(result.body.anchor.failed).toBeGreaterThanOrEqual(1);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 0, anchor_attempts: 1 });
  });

  it('does not publish a history whose middle bid was altered, even when the head still matches', async () => {
    const lot = await lotWithBids([50_000, 55_000]);
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('update public.bids set amount_cents = 51000 where lot_id = $1 and seq = 1', [lot.id]);
    });

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 0, anchor_attempts: 1 });
  });

  it('does not publish a lot whose head does not match its last bid', async () => {
    const lot = await lotWithBids([50_000]);
    await server.db.query("update public.lots set head_hash = repeat('0', 64) where id = $1", [lot.id]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 0, anchor_attempts: 1 });
  });
});

describe('the token never reaches the log', () => {
  it('keeps the token out of everything the publisher logs, whatever fails', async () => {
    const lot = await lotWithBids([50_000]);
    await only(lot);
    github.script(fileOf(lot.id), [await recorded('get-bad-token')]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await cron();
      expect(log.mock.calls.length).toBeGreaterThan(0);
      expect(log.mock.calls.flat().map(String).join(' ')).not.toContain('test-token');
    } finally {
      log.mockRestore();
    }
  });
});

describe('a failed publication is retried later, with a growing wait', () => {
  it('counts the failure, waits a minute, and publishes when the wait is over', async () => {
    const lot = await lotWithBids([50_000]);
    github.script(fileOf(lot.id), [await recorded('get-bad-token')]);

    const failed = await cron();

    expect(failed.status).toBe(500);
    expect(failed.body.anchor.failed).toBeGreaterThanOrEqual(1);
    const first = await progressOf(lot.id);
    expect(first.anchored_seq).toBe(0);
    expect(first.anchor_attempts).toBe(1);
    expect(first.seconds_to_retry).toBeGreaterThan(50);
    expect(first.seconds_to_retry).toBeLessThanOrEqual(60);

    github.reset();
    await cron();
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);

    await server.db.query("update public.lots set anchor_retry_at = clock_timestamp() - interval '1 second' where id = $1", [lot.id]);
    github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('put-create')]);
    await cron();
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 1, anchor_attempts: 0, seconds_to_retry: null });
  });

  it('doubles the wait after each failure in a row', async () => {
    const lot = await lotWithBids([50_000]);
    await server.db.query('update public.lots set anchor_attempts = 2 where id = $1', [lot.id]);
    github.script(fileOf(lot.id), [await recorded('get-bad-token')]);

    await cron();

    const progress = await progressOf(lot.id);
    expect(progress.anchor_attempts).toBe(3);
    expect(progress.seconds_to_retry).toBeGreaterThan(230);
    expect(progress.seconds_to_retry).toBeLessThanOrEqual(240);
  });
});

describe('the publisher never trusts, loses or duplicates what the anchor holds', () => {
  it('adds a line after a file that does not end with a newline, without gluing two lines together', async () => {
    const lot = await publishedLot([50_000]);
    await bidOn(lot.id, 55_000);
    const rows = await bidsOf(lot.id);
    const before = fileText(lot.id, rows.slice(0, 1)).trimEnd();
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(before), sha: 'sha-of-the-file' }), await recorded('put-update-ok')]);

    await cron();

    const lines = writtenContent(lot.id).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]?.startsWith(`${lot.id},2,`)).toBe(true);
  });

  it('refuses when the anchor lost a line that was published', async () => {
    const lot = await publishedLot([50_000, 55_000]);
    await bidOn(lot.id, 60_000);
    const rows = await bidsOf(lot.id);
    const withoutFirst = fileText(lot.id, rows.slice(1, 2));
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(withoutFirst), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 2, anchor_attempts: 1 });
  });

  it('refuses when a line that was published now holds another hash', async () => {
    const lot = await publishedLot([50_000, 55_000]);
    await bidOn(lot.id, 60_000);
    const rows = await bidsOf(lot.id);
    const changed = fileText(lot.id, [{ seq: 1, hash: 'e'.repeat(64) }, ...rows.slice(1, 2)]);
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(changed), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect((await progressOf(lot.id)).anchor_attempts).toBe(1);
  });

  it('refuses a file that holds a line of another lot', async () => {
    const lot = await lotWithBids([50_000]);
    const rows = await bidsOf(lot.id);
    // The line has the right hash of bid 1, under another lot: only the check of the lot refuses it.
    const foreign = `${fileText(lot.id, rows)}${randomUUID()},1,${rows[0]?.hash ?? ''},2026-10-24T20:00:00.000Z\n`;
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(foreign), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
  });

  it('recovers from a conflict: another writer changed the file, and the next run finds the line already there', async () => {
    const lot = await lotWithBids([50_000]);
    const rows = await bidsOf(lot.id);
    github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('put-create-existing-no-sha')]);

    const conflict = await cron();

    expect(conflict.status).toBe(500);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 0, anchor_attempts: 1 });

    await server.db.query("update public.lots set anchor_retry_at = clock_timestamp() - interval '1 second' where id = $1", [lot.id]);
    github.reset();
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(fileText(lot.id, rows)), sha: 'sha-of-the-file' })]);
    await cron();

    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 1, anchor_attempts: 0 });
  });

  it.each([
    ['a sequence number that is not a positive integer', (id: string, hash: string) => `${id},0,${hash},2026-10-24T20:00:00.000Z`],
    ['a sequence number written in hexadecimal', (id: string, hash: string) => `${id},0x1,${hash},2026-10-24T20:00:00.000Z`],
    ['a line with a field missing', (id: string, hash: string) => `${id},1,${hash}`],
    ['a line with a field too many', (id: string, hash: string) => `${id},1,${hash},2026-10-24T20:00:00.000Z,extra`],
  ])('refuses a file with %s', async (_what, line) => {
    const lot = await lotWithBids([50_000]);
    const rows = await bidsOf(lot.id);
    const bad = `${ANCHOR_HEADER}\n${line(lot.id, rows[0]?.hash ?? '')}\n`;
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(bad), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
  });

  it('reads a file saved with Windows line endings, and adds the new line', async () => {
    const lot = await publishedLot([50_000]);
    await bidOn(lot.id, 55_000);
    const rows = await bidsOf(lot.id);
    const windows = fileText(lot.id, rows.slice(0, 1)).replaceAll('\n', '\r\n');
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(windows), sha: 'sha-of-the-file' }), await recorded('put-update-ok')]);

    await cron();

    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect((await progressOf(lot.id)).anchored_seq).toBe(2);
  });

  it('never grows a file past the cap: just under it is read, and the line that pushes it over is refused', async () => {
    const lot = await publishedLot([50_000]);
    await bidOn(lot.id, 55_000);
    const rows = await bidsOf(lot.id);
    const line = `${lot.id},1,${rows[0]?.hash ?? ''},2026-10-24T20:00:00.000Z\n`;
    let nearlyFull = `${ANCHOR_HEADER}\n`;
    while (Buffer.byteLength(nearlyFull) + line.length < 599_950) nearlyFull += line;
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(nearlyFull), sha: 'sha-of-the-file' })]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await cron();
      expect(result.status).toBe(500);
      expect(log.mock.calls.some((call) => String(call[0]).includes(`${lot.id} not published (too_large)`))).toBe(true);
    } finally {
      log.mockRestore();
    }

    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses a file that holds two different hashes for one bid', async () => {
    const lot = await lotWithBids([50_000]);
    const rows = await bidsOf(lot.id);
    const first = rows[0];
    // The wrong hash comes first and the right one last: only a check for two hashes sees the first.
    const twice = `${ANCHOR_HEADER}\n${lot.id},1,${'d'.repeat(64)},2026-10-24T20:00:00.000Z\n${lot.id},1,${first?.hash ?? ''},2026-10-24T20:00:00.000Z\n`;
    expect(first?.hash).toBeTruthy();
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(twice), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
  });

  it('never rewrites a file that is too large for GitHub to read back: it is an incident named too_large', async () => {
    const lot = await publishedLot([50_000]);
    await bidOn(lot.id, 55_000);
    const rows = await bidsOf(lot.id);
    const huge = `${fileText(lot.id, rows.slice(0, 1))}${lot.id},9,${'a'.repeat(700_000)},2026-10-24T20:00:00.000Z\n`;
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(huge), sha: 'sha-of-the-file' })]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let result: Cron;
    try {
      result = await cron();
      expect(log.mock.calls.some((call) => String(call[0]).includes(`${lot.id} not published (too_large)`))).toBe(true);
    } finally {
      log.mockRestore();
    }

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect((await progressOf(lot.id)).anchored_seq).toBe(1);
  });
});

describe('a broken history is an incident, never a silent gap', () => {
  /** A lot that must not stay in the shared database as an unsettled, broken lot once the test is over. */
  const retire = (lotId: string) =>
    server.db.query("update public.lots set status = 'cancelled', anchored_seq = head_seq, anchor_retry_at = null where id = $1", [lotId]);

  it('reports a lot whose next bid row is gone, and counts it as stale at once', async () => {
    const lot = await publishedLot([50_000]);
    await bidOn(lot.id, 55_000);
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('delete from public.bids where lot_id = $1 and seq = 2', [lot.id]);
    });

    try {
      const first = await cron();
      expect(first.status).toBe(500);
      expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
      expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 1, anchor_attempts: 1 });
      const second = await cron();
      expect(second.body.anchor.stale).toBeGreaterThanOrEqual(1);
    } finally {
      await retire(lot.id);
    }
  });

  it('refuses a lot whose head runs ahead of its last bid, even when the hash matches', async () => {
    const lot = await lotWithBids([50_000]);
    await server.db.query('update public.lots set head_seq = head_seq + 1 where id = $1', [lot.id]);

    try {
      const result = await cron();
      expect(result.status).toBe(500);
      expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
      expect((await progressOf(lot.id)).anchor_attempts).toBe(1);
    } finally {
      await retire(lot.id);
    }
  });

  it('refuses when the anchor holds a bid that the history of the lot does not have', async () => {
    const lot = await lotWithBids([50_000]);
    const rows = await bidsOf(lot.id);
    const extra = `${fileText(lot.id, rows)}${lot.id},2,${'c'.repeat(64)},2026-10-24T20:00:00.000Z\n`;
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: b64(extra), sha: 'sha-of-the-file' })]);

    const result = await cron();

    expect(result.status).toBe(500);
    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET']);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 0, anchor_attempts: 1 });
  });
});

describe('edges of the file and of the run', () => {
  it('gives an existing empty file its header', async () => {
    const lot = await lotWithBids([50_000]);
    github.script(fileOf(lot.id), [await recorded('get-ok', { content: '', sha: 'sha-of-the-empty-file' }), await recorded('put-update-ok')]);

    await cron();

    const put = github.requestsFor(fileOf(lot.id)).find((r) => r.method === 'PUT');
    expect(put?.body?.sha).toBe('sha-of-the-empty-file');
    expect(writtenContent(lot.id).startsWith(`${ANCHOR_HEADER}\n${lot.id},1,`)).toBe(true);
  });

  it('starts no lot after the deadline of the request', async () => {
    const lot = await lotWithBids([50_000]);
    await only(lot);

    const result = await publishPending(server.db, config, { deadlineAtMs: Date.now() - 1 });

    expect(result).toMatchObject({ published: 0, failed: 0 });
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 0, anchor_attempts: 0 });
  });

  it('fits the 20 seconds the per-minute job waits: the last start, plus two calls, plus the budget', () => {
    expect(ANCHOR_LAST_START_MS + 2 * DEFAULT_TIMEOUT_MS).toBeLessThan(20_000);
    expect(RUN_BUDGET_MS + 2 * DEFAULT_TIMEOUT_MS).toBeLessThan(20_000);
  });
});

describe('runs overlap, and a refused token stops a run', () => {
  it('two runs at once publish a lot once: the second finds it taken', async () => {
    const lot = await lotWithBids([50_000]);
    await only(lot);
    // The first answer is slow, so the second run reads its candidates while the first still holds the lot.
    github.script(fileOf(lot.id), [{ ...(await recorded('get-missing')), delayMs: 300 }, await recorded('put-create')]);

    const [first, second] = await Promise.all([cron(), cron()]);

    expect(github.requestsFor(fileOf(lot.id)).map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect([first.body.anchor.mode, second.body.anchor.mode]).toEqual(['github', 'github']);
    expect(await progressOf(lot.id)).toMatchObject({ anchored_seq: 1, anchor_attempts: 0, seconds_to_retry: null });
  });

  it('stops at the first write answered 404 (wrong repository, branch or token access), leaving the next lot untouched', async () => {
    const one = await lotWithBids([50_000]);
    const two = await lotWithBids([50_000]);
    await only(one, two);
    for (const lot of [one, two]) github.script(fileOf(lot.id), [await recorded('get-missing'), await recorded('get-missing')]);

    const result = await cron();

    expect(result.status).toBe(500);
    const touched = [one, two].filter((lot) => github.requestsFor(fileOf(lot.id)).length > 0);
    expect(touched).toHaveLength(1);
    expect(github.requestsFor(fileOf(touched[0]?.id ?? '')).map((r) => r.method)).toEqual(['GET', 'PUT']);
  });

  it('stops at the first rate limit too, leaving the next lot untouched', async () => {
    const one = await lotWithBids([50_000]);
    const two = await lotWithBids([50_000]);
    await only(one, two);
    for (const lot of [one, two]) {
      github.script(fileOf(lot.id), [{ status: 429, headers: { 'content-type': 'application/json' }, body: { message: 'Too many requests' } }]);
    }

    const result = await cron();

    expect(result.status).toBe(500);
    expect([one, two].filter((lot) => github.requestsFor(fileOf(lot.id)).length > 0)).toHaveLength(1);
  });

  it('stops at the first refused token, leaving the next lot untouched', async () => {
    const one = await lotWithBids([50_000]);
    const two = await lotWithBids([50_000]);
    await only(one, two);
    for (const lot of [one, two]) github.script(fileOf(lot.id), [await recorded('get-bad-token')]);

    const result = await cron();

    expect(result.status).toBe(500);
    const touched = [one, two].filter((lot) => github.requestsFor(fileOf(lot.id)).length > 0);
    expect(touched).toHaveLength(1);
    const untouched = [one, two].find((lot) => !touched.includes(lot));
    expect(await progressOf(untouched?.id ?? '')).toMatchObject({ anchored_seq: 0, anchor_attempts: 0, seconds_to_retry: null });
  });
});

describe('a young pending head is a normal wait', () => {
  it('is not counted as stale even when its publication failed', async () => {
    const lot = await lotWithBids([50_000]);
    await only(lot);
    github.script(fileOf(lot.id), [await recorded('get-bad-token')]);

    const result = await cron();

    expect(result.body.anchor.failed).toBeGreaterThanOrEqual(1);
    expect(result.body.anchor.stale).toBe(0);
  });
});

describe('a run has a time budget', () => {
  it('stops starting new lots when the time is spent, and the next run publishes the rest', async () => {
    const one = await lotWithBids([50_000]);
    const two = await lotWithBids([50_000]);
    await server.db.query('update public.lots set anchored_seq = head_seq where id not in ($1, $2)', [one.id, two.id]);
    for (const lot of [one, two]) {
      github.script(fileOf(lot.id), [{ ...(await recorded('get-missing')), delayMs: 400 }, await recorded('put-create')]);
    }

    await publishPending(server.db, config, { budgetMs: 100 });

    // The lot with the oldest unpublished bid goes first.
    const touched = [one, two].filter((lot) => github.requestsFor(fileOf(lot.id)).length > 0);
    expect(touched).toEqual([one]);

    await cron();
    expect([(await progressOf(one.id)).anchored_seq, (await progressOf(two.id)).anchored_seq]).toEqual([1, 1]);
  });
});

describe('a head that waits too long is an incident', () => {
  it('answers 500 and counts it as stale after ten minutes pending', async () => {
    const lot = await lotWithBids([50_000]);
    // Skipped by the publisher (its retry is an hour away), and its first bid is eleven minutes old.
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query("update public.bids set placed_at = placed_at - interval '11 minutes' where lot_id = $1", [lot.id]);
      await tx.query("update public.lots set anchor_retry_at = clock_timestamp() + interval '1 hour' where id = $1", [lot.id]);
    });

    try {
      const result = await cron();
      expect(result.status).toBe(500);
      expect(result.body.anchor.stale).toBeGreaterThanOrEqual(1);
    } finally {
      await server.db.query('update public.lots set anchored_seq = head_seq, anchor_retry_at = null where id = $1', [lot.id]);
    }
  });
});

describe('with the mode off, nothing is published', () => {
  it('reports the mode, makes no request and leaves the lot pending', async () => {
    const lot = await lotWithBids([50_000]);
    const off = await startTestServer({ metApiUrl: met.baseUrl });

    try {
      const result = await cron(off.url);
      expect(result.body.anchor).toEqual({ mode: 'off', published: 0, failed: 0, stale: 0 });
      expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
      expect((await progressOf(lot.id)).anchored_seq).toBe(0);
    } finally {
      await off.close();
      await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    }
  });
});
