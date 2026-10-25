import type { AnchorResult, ChainResult, Headline, ReceiptHeadResult } from '@casa/contracts';
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

/** Whether the head a bidder kept is the stored hash of one of the bids, and of which. A made-up head is simply not found. */
export function receiptHeadResult(bids: { seq: number; hash: string }[], head: string): ReceiptHeadResult {
  const found = bids.find((bid) => bid.hash === head);
  return found ? { status: 'in_history', seq: found.seq } : { status: 'not_in_history' };
}

/**
 * What the page may say about the lot as a whole, in the order of D22 (the first rule that applies wins):
 * (1) tampered chain or divergent anchor: tampered, whatever the receipt says; (2) a head was sent and not found:
 * unconfirmed (never tampered, so a made-up head cannot accuse a lot); (3) no bids; (4) a receipt was found: intact up to
 * its seq; (5) no receipt: no divergence through the last published bid; (6) the anchor could not be read or is off.
 * There is no lot-wide "intact": the anchor cannot catch the removal of a last bid before its publication.
 */
export function headlineOf(input: { chain: ChainResult; anchor: AnchorResult; receiptHead: ReceiptHeadResult | undefined; bidCount: number }): Headline {
  const { chain, anchor, receiptHead, bidCount } = input;
  if (chain.status === 'tampered' || anchor.status === 'divergent') return { kind: 'tampered' };
  if (receiptHead?.status === 'not_in_history') return { kind: 'unconfirmed' };
  const unread = anchor.status === 'unavailable' || anchor.status === 'off';
  if (bidCount === 0) return { kind: 'no_bids', anchorUnverified: unread };
  if (anchor.status === 'unavailable' || anchor.status === 'off') return { kind: 'anchor_unverified' };
  if (receiptHead?.status === 'in_history') {
    return anchor.status === 'published'
      ? { kind: 'intact_until', seq: receiptHead.seq }
      : { kind: 'intact_chain_until', seq: receiptHead.seq, publishedThroughSeq: anchor.publishedThroughSeq };
  }
  return { kind: 'no_divergence_until', publishedThroughSeq: anchor.publishedThroughSeq };
}
