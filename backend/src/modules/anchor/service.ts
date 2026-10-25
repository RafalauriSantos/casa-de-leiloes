import type { Config } from '../../config';
import { firstBrokenSeq, type StoredBid } from '../../shared/bid-chain';
import { databaseNow } from '../../shared/clock';
import type { Db } from '../../shared/db';
import { AnchorError, readAnchorFile, writeAnchorFile, type GithubTarget } from './github-client';
import { ANCHOR_HEADER, anchorLine, isStalePending, retryDelayMs, seqsToPublish } from './rules';

/** A run stops starting new lots after this long; what is left waits for the next run. */
export const RUN_BUDGET_MS = 5_000;

/**
 * The per-minute job waits 20 s for the answer. After this long from the start of the request, settlement time included,
 * no lot is started, which leaves room for a lot started just before it: two calls of 4 s each. The database work after
 * the last start (the checks, the claim, the final update, the stale count) is not bounded here, and has about 4 s of margin.
 */
export const ANCHOR_LAST_START_MS = 8_000;

/** How many lots one run looks at. Lots are taken by the age of their oldest unpublished bid, so none waits for ever. */
const LOTS_PER_RUN = 20;

/** A run that takes a lot owns it for this long. Another run, or a crashed one, cannot publish the same lot meanwhile. */
const CLAIM_MS = 2 * 60_000;

/** GitHub reads a file of up to 1 MB through this API, and a write of this size must finish inside one call. A bigger file is never rewritten: it is an incident to look at. */
const MAX_FILE_BYTES = 600_000;

export interface PublishResult {
  mode: 'off' | 'github';
  published: number;
  failed: number;
  /** Lots whose oldest unpublished bid has waited too long (10 minutes or more). */
  stale: number;
}

interface ClaimedLot {
  anchored_seq: number;
}

interface BidRow {
  seq: number;
  bidder_id: string;
  amount_cents: number;
  placed_at: Date;
  prev_hash: string;
  hash: string;
}

const pathOf = (lotId: string) => `lots/${lotId}.csv`;

/**
 * The hashes a file holds, by sequence number. Two different hashes for one bid, or a line of another lot,
 * are an incident.
 */
function hashesInFile(content: string, lotId: string): Map<number, string> {
  const held = new Map<number, string>();
  for (const raw of content.split('\n')) {
    // A file saved on Windows ends its lines with a carriage return; it is not part of the line.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '' || line === ANCHOR_HEADER) continue;
    const fields = line.split(',');
    const [lot, seq, hash] = fields;
    if (fields.length !== 4 || lot !== lotId || seq === undefined || !/^[1-9]\d*$/.test(seq) || hash === undefined) {
      throw new AnchorError('integrity', 'The anchor file of the lot holds a line that is not a bid line of this lot.');
    }
    const number = Number(seq);
    const earlier = held.get(number);
    if (earlier !== undefined && earlier !== hash) {
      throw new AnchorError('integrity', `The anchor file holds two different hashes for bid ${String(number)}.`);
    }
    held.set(number, hash);
  }
  return held;
}

/**
 * The bids of a lot, read together with its head under a share lock on the lot, so that a bid placed
 * at that moment cannot make the head and the bids disagree. The chain must verify before anything is
 * published: the anchor never blesses a history that fails its own check.
 */
async function verifiedBids(db: Db, config: Config, lotId: string): Promise<StoredBid[]> {
  return db.tx(async (tx) => {
    const [lot] = await tx.query<{ head_seq: number; head_hash: string | null }>('select head_seq, head_hash from public.lots where id = $1 for share', [lotId]);
    const rows = await tx.query<BidRow>('select seq, bidder_id, amount_cents, placed_at, prev_hash, hash from public.bids where lot_id = $1 order by seq', [lotId]);
    const bids: StoredBid[] = rows.map((row) => ({
      lotId,
      seq: row.seq,
      bidderId: row.bidder_id,
      amountCents: row.amount_cents,
      placedAt: row.placed_at,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
    const last = bids.at(-1);
    if (!lot || !last || firstBrokenSeq(config.auditHmacSecret, lotId, bids, { seq: lot.head_seq, hash: lot.head_hash }) !== null) {
      throw new AnchorError('integrity', 'The history of the lot does not verify, so it is not published.');
    }
    return bids;
  });
}

/** Publishes the bids of one lot that the anchor does not hold yet, and records how far it got. */
async function publishLot(db: Db, config: Config, github: GithubTarget, lotId: string, anchoredSeq: number, nowIso: string): Promise<void> {
  const bids = await verifiedBids(db, config, lotId);
  const last = bids[bids.length - 1];
  if (!last) throw new AnchorError('integrity', 'The lot has no bids to publish.');

  const path = pathOf(lotId);
  const file = await readAnchorFile(github, path);
  if (file !== null && Buffer.byteLength(file.content, 'utf8') > MAX_FILE_BYTES) {
    throw new AnchorError('too_large', 'The anchor file of the lot is too large to update.');
  }
  const held = hashesInFile(file?.content ?? '', lotId);
  for (const seq of held.keys()) {
    if (seq > last.seq) throw new AnchorError('integrity', `The anchor holds bid ${String(seq)}, which the history of the lot does not have.`);
  }
  // Every bid is checked against the file, not only the new ones: what was published must still be there, unchanged.
  for (const bid of bids) {
    const published = held.get(bid.seq);
    if (published !== undefined && published !== bid.hash) {
      throw new AnchorError('integrity', `The anchor holds a different hash for bid ${String(bid.seq)}.`);
    }
    if (published === undefined && bid.seq <= anchoredSeq) {
      throw new AnchorError('integrity', `The anchor lost the hash of bid ${String(bid.seq)}, which was published.`);
    }
  }

  const wanted = new Set(seqsToPublish(anchoredSeq, last.seq));
  const missing = bids.filter((bid) => wanted.has(bid.seq) && !held.has(bid.seq));
  if (missing.length > 0) {
    const existing = file === null || file.content.trim() === '' ? `${ANCHOR_HEADER}\n` : file.content.endsWith('\n') ? file.content : `${file.content}\n`;
    const lines = missing.map((bid) => anchorLine({ lotId, seq: bid.seq, hash: bid.hash, publishedAt: nowIso }));
    const content = `${existing}${lines.join('\n')}\n`;
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new AnchorError('too_large', 'The anchor file of the lot is too large to update.');
    const message = `anchor ${lotId} bids ${String(missing[0]?.seq)} to ${String(last.seq)}`;
    await writeAnchorFile(github, path, content, file?.sha, message);
  }

  await db.query('update public.lots set anchored_seq = greatest(anchored_seq, $2), anchor_attempts = 0, anchor_retry_at = null where id = $1', [lotId, last.seq]);
}

/** Counts a failed attempt and sets the wait before the next one. It must never throw: the run goes on. */
async function recordFailure(db: Db, lotId: string): Promise<void> {
  try {
    const [row] = await db.query<{ anchor_attempts: number }>(
      'update public.lots set anchor_attempts = anchor_attempts + 1 where id = $1 and anchored_seq < head_seq returning anchor_attempts',
      [lotId],
    );
    if (row) {
      const retryAt = new Date((await databaseNow(db)).getTime() + retryDelayMs(row.anchor_attempts));
      await db.query('update public.lots set anchor_retry_at = $2 where id = $1 and anchored_seq < head_seq', [lotId, retryAt]);
    }
  } catch (error) {
    console.error(`anchor: could not record the failure of lot ${lotId}: ${error instanceof Error ? error.message : 'unexpected error'}`);
  }
}

export interface PublishOptions {
  /** How long a run may keep starting lots. */
  budgetMs?: number;
  /** An epoch time after which no new lot is started: the end of the request's own window. */
  deadlineAtMs?: number;
}

/**
 * Publishes the pending bid hashes to the public anchor (D21). A failure never stops the other lots: it is
 * counted, logged without any secret, and the lot waits (1, 2, 4, 8 minutes, at most 15) before its next try.
 * A refused token or a rate limit stops the run, since the next lot would fail the same way.
 * After the run, the lots whose oldest unpublished bid is 10 minutes old or more are counted as stale.
 */
export async function publishPending(db: Db, config: Config, options: PublishOptions = {}): Promise<PublishResult> {
  const { anchor } = config;
  if (anchor.mode === 'off') return { mode: 'off', published: 0, failed: 0, stale: 0 };

  const now = await databaseNow(db);
  const candidates = await db.query<{ id: string }>(
    `select l.id from public.lots l
     left join public.bids b on b.lot_id = l.id and b.seq = l.anchored_seq + 1
     where l.head_seq > l.anchored_seq and (l.anchor_retry_at is null or l.anchor_retry_at <= $1)
     order by b.placed_at asc nulls first, l.id
     limit ${String(LOTS_PER_RUN)}`,
    [now],
  );

  let published = 0;
  let failed = 0;
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const started = performance.now();
  for (const { id } of candidates) {
    if (performance.now() - started >= budgetMs) break;
    if (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) break;
    // Take the lot before working on it, so that a run in parallel skips it.
    const [claimed] = await db.query<ClaimedLot>(
      `update public.lots set anchor_retry_at = $2
       where id = $1 and head_seq > anchored_seq and (anchor_retry_at is null or anchor_retry_at <= $3)
       returning anchored_seq`,
      [id, new Date(now.getTime() + CLAIM_MS), now],
    );
    if (!claimed) continue;
    try {
      await publishLot(db, config, anchor, id, claimed.anchored_seq, now.toISOString());
      published += 1;
    } catch (error) {
      failed += 1;
      await recordFailure(db, id);
      const kind = error instanceof AnchorError ? error.kind : 'unexpected';
      console.error(`anchor: lot ${id} not published (${kind}): ${error instanceof AnchorError ? error.message : 'unexpected error'}`);
      if (kind === 'rate_limit' || kind === 'auth') break;
    }
  }

  // A lot whose next bid row is gone (placed_at is null) is stale at once: its history is broken, not slow.
  const waiting = await db.query<{ placed_at: Date | null }>(
    `select b.placed_at from public.lots l
     left join public.bids b on b.lot_id = l.id and b.seq = l.anchored_seq + 1
     where l.head_seq > l.anchored_seq`,
  );
  const stale = waiting.filter((row) => row.placed_at === null || isStalePending(row.placed_at.getTime(), now.getTime())).length;
  if (stale > 0) console.error(`anchor: ${String(stale)} lot(s) have a bid hash pending for 10 minutes or more`);

  return { mode: 'github', published, failed, stale };
}
