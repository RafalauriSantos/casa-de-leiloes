// The anchor is a public, append-only file of bid hashes (D21). These are its pure rules: the line
// format, which bids still need publishing, how long to wait after a failure, and when a head that
// has waited too long counts as an incident. Times are numbers in milliseconds: the clock is a parameter.

export interface AnchoredBid {
  lotId: string;
  seq: number;
  hash: string;
  /** ISO time of the publication. */
  publishedAt: string;
}

/** The first line of every anchor file. */
export const ANCHOR_HEADER = 'lot_id,seq,head_hash,published_at';

/** One line of the anchor file: lot, sequence number, hash and publication time, comma separated. */
export function anchorLine(entry: AnchoredBid): string {
  return `${entry.lotId},${String(entry.seq)},${entry.hash},${entry.publishedAt}`;
}

/** The sequence numbers still to publish: those after the last anchored one, up to the lot's head. */
export function seqsToPublish(anchoredSeq: number, headSeq: number): number[] {
  const seqs: number[] = [];
  for (let seq = anchoredSeq + 1; seq <= headSeq; seq += 1) seqs.push(seq);
  return seqs;
}

const RETRY_BASE_MS = 60_000;
const RETRY_CAP_MS = 15 * 60_000;

/** The wait after `failedAttempts` failures in a row: 1, 2, 4, 8 minutes, and never more than 15. */
export function retryDelayMs(failedAttempts: number): number {
  if (!(failedAttempts >= 1)) return 0;
  return Math.min(RETRY_BASE_MS * 2 ** (failedAttempts - 1), RETRY_CAP_MS);
}

/** A head waiting this long is an incident to report, not a normal wait. */
export const STALE_PENDING_MS = 10 * 60_000;

export function isStalePending(pendingSinceMs: number, nowMs: number): boolean {
  return nowMs - pendingSinceMs >= STALE_PENDING_MS;
}
