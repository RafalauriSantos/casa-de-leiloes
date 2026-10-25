import type { AnchorResult, ChainResult } from '@casa/contracts';
import { isStalePending } from '../anchor';

/** The public time of a bid: truncated to the second, never rounded up (D10). Takes an ISO string, so no clock or Date is needed. */
export function truncateToSecond(iso: string): string {
  return `${iso.slice(0, 19)}Z`;
}

/** The chain result from the first broken seq, which `firstBrokenSeq` returns (null when the history is intact). */
export function chainResult(brokenAtSeq: number | null): ChainResult {
  return brokenAtSeq === null ? { status: 'intact' } : { status: 'tampered', brokenAtSeq };
}

/** What the anchor file holds, read for a lot: `held` maps a seq to the hash published for it (empty when there is no file). */
export interface AnchorView {
  held: ReadonlyMap<number, string>;
  /** How far the lot says the publisher got. It must be read before the file (D22). */
  anchoredSeq: number;
}

export interface BidForComparison {
  seq: number;
  hash: string;
  placedAtMs: number;
}

/**
 * Compares the history with the anchor file (D22). Divergent when the file holds a bid the history does not have or a
 * different hash, skips a bid above `anchoredSeq` (the publisher never writes that), or lacks a bid at or below
 * `anchoredSeq`; the seq reported is the lowest of those. Otherwise published when every bid is in the file, and pending
 * when only the latest are missing.
 */
export function compareWithAnchor(bids: BidForComparison[], view: AnchorView, nowMs: number): Exclude<AnchorResult, { status: 'unavailable' | 'off' }> {
  const bySeq = new Map(bids.map((bid) => [bid.seq, bid]));
  const problems: number[] = [];

  for (const [seq, hash] of view.held) {
    if (bySeq.get(seq)?.hash !== hash) problems.push(seq);
  }
  let publishedThrough = 0;
  while (view.held.has(publishedThrough + 1)) publishedThrough += 1;
  const skipped = publishedThrough + 1;
  if ([...view.held.keys()].some((seq) => seq > skipped) && skipped > view.anchoredSeq) problems.push(skipped);
  for (let seq = 1; seq <= view.anchoredSeq; seq += 1) {
    if (!view.held.has(seq)) problems.push(seq);
  }
  if (problems.length > 0) return { status: 'divergent', atSeq: Math.min(...problems) };

  const lastSeq = bids.at(-1)?.seq ?? 0;
  if (publishedThrough >= lastSeq) return { status: 'published', publishedThroughSeq: publishedThrough };
  const oldestWaiting = bySeq.get(publishedThrough + 1);
  // A history with no bid right after the published ones is broken, not slow: the chain result says so, and it is stale at once.
  const stale = oldestWaiting === undefined || isStalePending(oldestWaiting.placedAtMs, nowMs);
  return { status: 'pending', publishedThroughSeq: publishedThrough, stale };
}
