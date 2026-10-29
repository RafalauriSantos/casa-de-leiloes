import type { AnchorResult, AuditReport } from '@casa/contracts';
import type { Config } from '../../config';
import { firstBrokenSeq, pseudonymFor } from '../../shared/bid-chain';
import { readBids } from '../../shared/bid-history';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { databaseNow } from '../../shared/clock';
import type { AnchorRead, AnchorReader } from './anchor-reader';
import type { AuditOptions } from './options';
import { chainResult, compareWithAnchor, headlineOf, receiptHeadResult, truncateToSecond } from './rules';

/** The lot row and its bids in one repeatable-read transaction, without locks (D22): a bid placed meanwhile cannot make the head copy and the bids disagree. */
async function snapshotOf(db: Db, lotId: string) {
  return db.tx(async (tx) => {
    await tx.query('set transaction isolation level repeatable read');
    const [found] = await tx.query<{ head_seq: number; head_hash: string | null }>('select head_seq, head_hash from public.lots where id = $1', [lotId]);
    if (!found) throw new AppError('not_found', 'Lote não encontrado.');
    return { lot: found, bids: await readBids(tx, lotId) };
  });
}

/** Step 1 of the read order, and the 404: only a lot that does not exist is refused, and before any GitHub call. */
async function anchoredSeqOf(db: Db, lotId: string): Promise<number> {
  const [row] = await db.query<{ anchored_seq: number }>('select anchored_seq from public.lots where id = $1', [lotId]);
  if (!row) throw new AppError('not_found', 'Lote não encontrado.');
  return row.anchored_seq;
}

/**
 * One pass in the order D22 needs: the lot's anchored_seq, then the anchor file, then the snapshot of the lot and its bids.
 * A bid placed or published between the steps then shows as pending, never as a bid the history lost.
 */
async function onePass(db: Db, config: Config, reader: AnchorReader | undefined, lotId: string, deadlineMs: number, fresh: boolean, head: string | undefined): Promise<AuditReport> {
  const anchoredSeq = await anchoredSeqOf(db, lotId);
  const read: AnchorRead | undefined = reader ? await reader.read(lotId, anchoredSeq, deadlineMs, fresh) : undefined;
  const { lot, bids } = await snapshotOf(db, lotId);

  let anchor: AnchorResult;
  if (read === undefined) anchor = { status: 'off' };
  else if (read.kind === 'unavailable') anchor = { status: 'unavailable' };
  else if (read.kind === 'malformed') anchor = { status: 'divergent', atSeq: null };
  else {
    const nowMs = (await databaseNow(db)).getTime();
    anchor = compareWithAnchor(
      bids.map((bid) => ({ seq: bid.seq, hash: bid.hash, placedAtMs: bid.placedAt.getTime() })),
      { held: read.held, anchoredSeq: read.anchoredSeq },
      nowMs,
    );
  }
  const chain = chainResult(firstBrokenSeq(config.auditHmacSecret, lotId, bids, { seq: lot.head_seq, hash: lot.head_hash }));
  const receiptHead = head === undefined ? undefined : receiptHeadResult(bids, head);
  return {
    lotId,
    bids: bids.map((bid) => ({
      seq: bid.seq,
      bidderLabel: pseudonymFor(config.auditHmacSecret, lotId, bid.bidderId),
      amountCents: bid.amountCents,
      placedAt: truncateToSecond(bid.placedAt.toISOString()),
      hash: bid.hash,
    })),
    chain,
    anchor,
    ...(receiptHead === undefined ? {} : { receiptHead }),
    ...(config.anchor.mode === 'github' ? { anchorFileUrl: `https://github.com/${config.anchor.repo}/blob/${config.anchor.branch}/lots/${lotId}.csv` } : {}),
    headline: headlineOf({ chain, anchor, receiptHead, bidCount: bids.length }),
  };
}

/**
 * The public audit of a lot (D22). Only a lot that does not exist is a 404: its status, bid count and head are fields
 * that tampering can rewrite, and the audit must not trust them. A divergence is checked once more with a fresh read
 * (never the cache) before it is reported, and if that read fails or the time budget is spent it is `unavailable`,
 * because a stale answer from GitHub must not show a healthy lot as tampered.
 */
export async function auditReport(db: Db, config: Config, reader: AnchorReader | undefined, options: AuditOptions, lotId: string, head?: string): Promise<AuditReport> {
  const deadlineMs = Date.now() + options.budgetMs;
  const first = await onePass(db, config, reader, lotId, deadlineMs, false, head);
  if (first.anchor.status !== 'divergent' || first.anchor.atSeq === null) return first;

  await new Promise((resolve) => setTimeout(resolve, options.rereadWaitMs));
  return onePass(db, config, reader, lotId, deadlineMs, true, head);
}
