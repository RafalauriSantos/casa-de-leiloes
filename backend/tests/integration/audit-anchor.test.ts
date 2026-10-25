import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditReport, OwnLot } from '@casa/contracts';
import type { Config } from '../../src/config';
import { ANCHOR_HEADER, MAX_ANCHOR_FILE_BYTES } from '../../src/modules/anchor';
import { signUpUser, type TestUser } from '../helpers/auth';
import { BRANCH, recorded, startGithubStub, type GithubStub, type StubAnswer } from '../helpers/github-stub';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

// D22, slice 3: the audit compares the history with the public anchor. GitHub is the local stub answering with
// answers recorded from a scratch repository (helpers/github-stub.ts); the audit code runs unchanged against it.

let met: MetStub;
let github: GithubStub;
let auctioneer: TestUser;
let server: TestServer;
let setup: TestServer;
/** Lots these tests tamper with fail the integrity check for ever; they are cancelled at the end so the settlement of later tests does not retry them. */
const made: string[] = [];

const config = (): Config => ({
  ...testConfig(),
  metApiUrl: met.baseUrl,
  anchor: { mode: 'github', repo: 'owner/anchor', token: 'test-token', apiUrl: github.baseUrl, branch: 'main' },
});

beforeAll(async () => {
  met = await startMetStub();
  github = await startGithubStub();
  setup = await startTestServer(config());
  auctioneer = await createAuctioneer(setup);
});
afterAll(async () => {
  await setup.db.query("update public.lots set status = 'cancelled' where id = any($1::uuid[])", [made]);
  await setup.close();
  await github.close();
  await met.close();
});
beforeEach(async () => {
  github.reset();
  // One server per test: the cache and the call limit belong to the server, so tests cannot feed each other.
  server = await startTestServer(config(), { audit: { rereadWaitMs: 20 } });
});
afterEach(async () => {
  await server.close();
});

const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });
const b64 = (text: string) => Buffer.from(text).toString('base64');
const fileOf = (lotId: string) => `lots/${lotId}.csv`;

async function bidder(): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${setup.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: 1_000_000 }),
  });
  expect(deposit.status).toBe(201);
  return user;
}

async function bidOn(lotId: string, amountCents: number): Promise<void> {
  const response = await fetch(`${setup.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(await bidder()), body: JSON.stringify({ amountCents }) });
  expect(response.status).toBe(201);
}

/** A live lot with one bid per amount, 50,000 and up. */
async function lotWithBids(count: number): Promise<OwnLot> {
  const created = await fetch(`${setup.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(setup), { startingBidCents: 50_000, incrementCents: 5_000 })) });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  made.push(lot.id);
  const now = await dbNow(setup);
  await setup.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [lot.id, new Date(now.getTime() - minutes(5)), new Date(now.getTime() + minutes(60))]);
  for (let index = 0; index < count; index += 1) await bidOn(lot.id, 50_000 + index * 5_000);
  return lot;
}

const hashes = async (lotId: string) => (await setup.db.query<{ seq: number; hash: string }>('select seq, hash from public.bids where lot_id = $1 order by seq', [lotId]));
const setAnchored = (lotId: string, seq: number) => setup.db.query('update public.lots set anchored_seq = $2 where id = $1', [lotId, seq]);

/** The text of a published file: the header, then one line per row. */
const fileText = (lotId: string, rows: { seq: number; hash: string }[]) => `${ANCHOR_HEADER}\n${rows.map((row) => `${lotId},${String(row.seq)},${row.hash},2026-10-24T20:00:00.000Z`).join('\n')}\n`;
const fileAnswer = (text: string) => recorded('get-ok', { content: b64(text), sha: 'sha-of-the-file' });
const missingFile = () => recorded('get-missing');
const branchOk = () => recorded('get-branch-ok');

/** The file holding the first `count` bids of the lot, scripted as the answer to the next read. */
async function filesWith(lotId: string, count: number): Promise<StubAnswer> {
  return fileAnswer(fileText(lotId, (await hashes(lotId)).slice(0, count)));
}

const audit = async (lotId: string, base = server): Promise<AuditReport> => {
  const response = await fetch(`${base.url}/api/lots/${lotId}/audit`);
  expect(response.status).toBe(200);
  return (await response.json()) as AuditReport;
};

describe('the anchor result of a lot', () => {
  it('is published when the file holds every bid with its hash, and the audit read the file with the token', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 3)]);

    const report = await audit(lot.id);

    expect(report.anchor).toEqual({ status: 'published', publishedThroughSeq: 3 });
    expect(report.chain).toEqual({ status: 'intact' });
    const [request] = github.requestsFor(fileOf(lot.id));
    expect(request?.method).toBe('GET');
    expect(request?.headers['authorization']).toBe('Bearer test-token');
  });

  it('is pending when the file holds the first bids and the publisher has not reached the rest', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 1);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 1)]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'pending', publishedThroughSeq: 1, stale: false });
  });

  it('is pending for a lot with bids and no file at all, after the branch confirms the file is only missing', async () => {
    const lot = await lotWithBids(2);
    github.script(fileOf(lot.id), [await missingFile()]);
    github.script(BRANCH, [await branchOk()]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'pending', publishedThroughSeq: 0, stale: false });
    expect(github.requestsFor(BRANCH)).toHaveLength(1);
  });

  it('is published for a lot with no bids and no file, and still reads the file', async () => {
    const lot = await lotWithBids(0);
    github.script(fileOf(lot.id), [await missingFile()]);
    github.script(BRANCH, [await branchOk()]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'published', publishedThroughSeq: 0 });
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(1);
  });

  it('is divergent when the last bid was removed after it was published: the file holds a bid the history does not have', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    const published = await filesWith(lot.id, 3);
    // The attacker: remove bid 3 and rewrite the lot's head to the state before it. The chain alone cannot see it.
    await setup.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('delete from public.bids where lot_id = $1 and seq = 3', [lot.id]);
      await tx.query('update public.lots set head_seq = 2, bid_count = 2, anchored_seq = 2, head_hash = (select hash from public.bids where lot_id = $1 and seq = 2) where id = $1', [lot.id]);
    });
    github.script(fileOf(lot.id), [published, published]);

    const report = await audit(lot.id);

    expect(report.chain).toEqual({ status: 'intact' });
    expect(report.anchor).toEqual({ status: 'divergent', atSeq: 3 });
  });

  it('is divergent at a bid whose published hash differs, a lost line, a line of another lot and a malformed line', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    const rows = await hashes(lot.id);
    const differs = rows.map((row) => (row.seq === 2 ? { ...row, hash: 'f'.repeat(64) } : row));

    github.script(fileOf(lot.id), [fileAnswer(fileText(lot.id, differs)), fileAnswer(fileText(lot.id, differs))]);
    expect((await audit(lot.id)).anchor).toEqual({ status: 'divergent', atSeq: 2 });

    const lost = await lotWithBids(3);
    await setAnchored(lost.id, 3);
    const lostRows = (await hashes(lost.id)).filter((row) => row.seq !== 2);
    github.script(fileOf(lost.id), [fileAnswer(fileText(lost.id, lostRows)), fileAnswer(fileText(lost.id, lostRows))]);
    expect((await audit(lost.id)).anchor).toEqual({ status: 'divergent', atSeq: 2 });

    const foreign = await lotWithBids(1);
    github.script(fileOf(foreign.id), [fileAnswer(`${ANCHOR_HEADER}\n${randomUUID()},1,${'a'.repeat(64)},2026-10-24T20:00:00.000Z\n`)]);
    expect((await audit(foreign.id)).anchor).toEqual({ status: 'divergent', atSeq: null });

    const malformed = await lotWithBids(1);
    github.script(fileOf(malformed.id), [fileAnswer(`${ANCHOR_HEADER}\nnot a bid line\n`)]);
    expect((await audit(malformed.id)).anchor).toEqual({ status: 'divergent', atSeq: null });
  });

  it('is divergent when a lot says it was published and the file is confirmed missing', async () => {
    const lot = await lotWithBids(1);
    await setAnchored(lot.id, 1);
    github.script(fileOf(lot.id), [await missingFile(), await missingFile()]);
    github.script(BRANCH, [await branchOk(), await branchOk()]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'divergent', atSeq: 1 });
  });

  it('reads a file saved with carriage returns the same way the publisher does', async () => {
    const lot = await lotWithBids(2);
    await setAnchored(lot.id, 2);
    github.script(fileOf(lot.id), [fileAnswer(fileText(lot.id, await hashes(lot.id)).replace(/\n/g, '\r\n'))]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'published', publishedThroughSeq: 2 });
  });
});

describe('the headline, with the anchor read', () => {
  const withHead = async (lotId: string, seq: number): Promise<AuditReport> => {
    const hash = (await hashes(lotId)).find((row) => row.seq === seq)?.hash ?? '';
    const response = await fetch(`${server.url}/api/lots/${lotId}/audit?head=${hash}`);
    expect(response.status).toBe(200);
    return (await response.json()) as AuditReport;
  };

  it('is intact only up to the seq of a receipt that was found, when the anchor is published', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 3)]);

    const report = await withHead(lot.id, 3);

    expect(report.receiptHead).toEqual({ status: 'in_history', seq: 3 });
    expect(report.headline).toEqual({ kind: 'intact_until', seq: 3 });
  });

  it('says the chain only, and how far the anchor goes, when the anchor is pending', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 1);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 1)]);

    expect((await withHead(lot.id, 3)).headline).toEqual({ kind: 'intact_chain_until', seq: 3, publishedThroughSeq: 1 });
  });

  it('says no divergence through the last published bid, never intact, when no head was sent', async () => {
    const published = await lotWithBids(2);
    await setAnchored(published.id, 2);
    github.script(fileOf(published.id), [await filesWith(published.id, 2)]);
    expect((await audit(published.id)).headline).toEqual({ kind: 'no_divergence_until', publishedThroughSeq: 2 });

    const pending = await lotWithBids(2);
    await setAnchored(pending.id, 1);
    github.script(fileOf(pending.id), [await filesWith(pending.id, 1)]);
    expect((await audit(pending.id)).headline).toEqual({ kind: 'no_divergence_until', publishedThroughSeq: 1 });
  });

  it('says tampered when the anchor is divergent, even when the receipt is found', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    const published = await filesWith(lot.id, 3);
    await setup.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('delete from public.bids where lot_id = $1 and seq = 3', [lot.id]);
      await tx.query('update public.lots set head_seq = 2, bid_count = 2, anchored_seq = 2, head_hash = (select hash from public.bids where lot_id = $1 and seq = 2) where id = $1', [lot.id]);
    });
    github.script(fileOf(lot.id), [published, published]);

    const report = await audit(lot.id);

    expect(report.chain).toEqual({ status: 'intact' });
    expect(report.headline).toEqual({ kind: 'tampered' });
  });

  it('says the anchor was not verified, with the receipt result on its own, when GitHub cannot be read', async () => {
    const lot = await lotWithBids(2);
    github.script(fileOf(lot.id), [{ status: 503, headers: {}, body: { message: 'down' } }]);

    const report = await withHead(lot.id, 2);

    expect(report.anchor).toEqual({ status: 'unavailable' });
    expect(report.receiptHead).toEqual({ status: 'in_history', seq: 2 });
    expect(report.headline).toEqual({ kind: 'anchor_unverified' });
  });
});

describe('the audit never claims what it could not read', () => {
  it('is unavailable when a missing file cannot be confirmed: a wrong repository or branch also answers 404', async () => {
    const lot = await lotWithBids(1);
    await setAnchored(lot.id, 1);
    github.script(fileOf(lot.id), [await missingFile()]);
    github.script(BRANCH, [await recorded('get-missing')]);

    const report = await audit(lot.id);

    expect(report.anchor).toEqual({ status: 'unavailable' });
    expect(report.chain).toEqual({ status: 'intact' });
  });

  it('is unavailable for a refused token, a rate limit, a server error and a file that is too large', async () => {
    const refused = await lotWithBids(1);
    github.script(fileOf(refused.id), [await recorded('get-bad-token')]);
    expect((await audit(refused.id)).anchor).toEqual({ status: 'unavailable' });

    const limited = await lotWithBids(1);
    github.script(fileOf(limited.id), [{ status: 429, headers: { 'retry-after': '60' }, body: { message: 'rate limited' } }]);
    expect((await audit(limited.id)).anchor).toEqual({ status: 'unavailable' });

    const broken = await lotWithBids(1);
    github.script(fileOf(broken.id), [{ status: 503, headers: {}, body: { message: 'down' } }]);
    expect((await audit(broken.id)).anchor).toEqual({ status: 'unavailable' });

    const large = await lotWithBids(1);
    const padding = `${'x'.repeat(MAX_ANCHOR_FILE_BYTES)}\n`;
    github.script(fileOf(large.id), [fileAnswer(padding)]);
    expect((await audit(large.id)).anchor).toEqual({ status: 'unavailable' });
  });

  it('is unavailable, and not hung, when GitHub is slower than the time budget of the request', async () => {
    const lot = await lotWithBids(1);
    github.script(fileOf(lot.id), [{ ...(await missingFile()), delayMs: 3_000 }]);
    const slow = await startTestServer(config(), { audit: { budgetMs: 300, rereadWaitMs: 20 } });
    try {
      const started = Date.now();
      const report = await audit(lot.id, slow);

      expect(report.anchor).toEqual({ status: 'unavailable' });
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      await slow.close();
    }
  });

  it('is off, with no call to GitHub, when the anchor is not configured', async () => {
    const lot = await lotWithBids(1);
    const off = await startTestServer({ ...config(), anchor: { mode: 'off' } });
    try {
      expect((await audit(lot.id, off)).anchor).toEqual({ status: 'off' });
      expect(github.requests).toEqual([]);
    } finally {
      await off.close();
    }
  });

  it('makes no call to GitHub for a lot that does not exist', async () => {
    const response = await fetch(`${server.url}/api/lots/${randomUUID()}/audit`);

    expect(response.status).toBe(404);
    expect(github.requests).toEqual([]);
  });
});

describe('a read that is stale or in between never shows a healthy lot as tampered', () => {
  it('reads again before it reports a divergence: a stale first answer is replaced by the true one', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 2), await filesWith(lot.id, 3)]);

    const report = await audit(lot.id);

    expect(report.anchor).toEqual({ status: 'published', publishedThroughSeq: 3 });
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(2);

    // The pair of the re-read replaced the stale one in the cache: the next audit is served from it and is published too.
    expect((await audit(lot.id)).anchor).toEqual({ status: 'published', publishedThroughSeq: 3 });
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(2);
  });

  it('reports unavailable, never divergent, when the second read fails', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 2), { status: 503, headers: {}, body: { message: 'down' } }]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'unavailable' });
  });

  it('reads the file before the database snapshot: a bid published while the file is being read is pending or published, not divergent', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 3);
    github.script(fileOf(lot.id), [
      // At the moment GitHub answers, a fourth bid is placed and the publisher has already written it to the file.
      async () => {
        await bidOn(lot.id, 80_000);
        const rows = await hashes(lot.id);
        expect(rows).toHaveLength(4);
        return fileAnswer(fileText(lot.id, rows));
      },
    ]);

    const report = await audit(lot.id);

    expect(report.bids).toHaveLength(4);
    expect(report.chain).toEqual({ status: 'intact' });
    expect(report.anchor).toEqual({ status: 'published', publishedThroughSeq: 4 });
  });

  it('reads anchored_seq before the file: a publisher that raises it while the file is being read is not a divergence', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 2);
    const older = await filesWith(lot.id, 2);
    const answerWhileTheLotMovesOn = async () => {
      // The publisher writes bid 3 and raises anchored_seq right after this answer, which still holds only bids 1 and 2.
      await setAnchored(lot.id, 3);
      return older;
    };
    github.script(fileOf(lot.id), [answerWhileTheLotMovesOn, filesWith(lot.id, 2)]);

    const report = await audit(lot.id);

    expect(report.anchor).toEqual({ status: 'pending', publishedThroughSeq: 2, stale: false });
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(1);
  });

  it('keeps anchored_seq and the file together in the cache: a fresher anchored_seq against an older file is not a divergence', async () => {
    const lot = await lotWithBids(3);
    await setAnchored(lot.id, 2);
    github.script(fileOf(lot.id), [await filesWith(lot.id, 2)]);
    expect((await audit(lot.id)).anchor).toEqual({ status: 'pending', publishedThroughSeq: 2, stale: false });

    // The publisher then writes bid 3 and raises anchored_seq. The cached pair is the one read together.
    await setAnchored(lot.id, 3);
    const again = await audit(lot.id);

    expect(again.anchor).toEqual({ status: 'pending', publishedThroughSeq: 2, stale: false });
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(1);
  });
});

describe('the cache and the call limit of the audit', () => {
  it('answers a second audit of the same lot from the cache, and a failed read is not cached', async () => {
    const lot = await lotWithBids(1);
    await setAnchored(lot.id, 1);
    github.script(fileOf(lot.id), [{ status: 503, headers: {}, body: { message: 'down' } }, await filesWith(lot.id, 1)]);

    expect((await audit(lot.id)).anchor).toEqual({ status: 'unavailable' });
    expect((await audit(lot.id)).anchor).toEqual({ status: 'published', publishedThroughSeq: 1 });
    expect((await audit(lot.id)).anchor).toEqual({ status: 'published', publishedThroughSeq: 1 });
    expect(github.requestsFor(fileOf(lot.id))).toHaveLength(2);
  });

  it('reads GitHub again once the cache has expired', async () => {
    const lot = await lotWithBids(2);
    await setAnchored(lot.id, 2);
    const short = await startTestServer(config(), { audit: { cacheMs: 50, rereadWaitMs: 20 } });
    try {
      github.script(fileOf(lot.id), [await filesWith(lot.id, 2), await filesWith(lot.id, 2)]);
      await audit(lot.id, short);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await audit(lot.id, short);

      expect(github.requestsFor(fileOf(lot.id))).toHaveLength(2);
    } finally {
      await short.close();
    }
  });

  it('stops calling GitHub above the limit per minute and says unavailable', async () => {
    const limited = await startTestServer(config(), { audit: { callsPerMinute: 2, rereadWaitMs: 20 } });
    try {
      const lots = [await lotWithBids(0), await lotWithBids(0), await lotWithBids(0)];
      for (const lot of lots) github.script(fileOf(lot.id), [await missingFile()]);
      github.script(BRANCH, [await branchOk(), await branchOk(), await branchOk()]);

      // The first audit uses both calls it is allowed in this minute: the file, then the branch that confirms it is missing.
      const first = await audit(lots[0]?.id ?? '', limited);
      const second = await audit(lots[1]?.id ?? '', limited);
      const third = await audit(lots[2]?.id ?? '', limited);

      expect(first.anchor).toEqual({ status: 'published', publishedThroughSeq: 0 });
      expect(second.anchor).toEqual({ status: 'unavailable' });
      expect(third.anchor).toEqual({ status: 'unavailable' });
      expect(github.requests).toHaveLength(2);
    } finally {
      await limited.close();
    }
  });
});
