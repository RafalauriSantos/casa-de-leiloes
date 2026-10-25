import { createHmac } from 'node:crypto';

/**
 * The bid history is a keyed hash chain. Each bid's hash covers its own fields and the previous hash,
 * under a secret that lives only in the server's environment. Changing, removing, inserting or
 * reordering a bid breaks the chain from that point on, and nobody without the secret can make a
 * valid replacement. Times are hashed in ISO form with milliseconds, the precision the rows keep.
 */
function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function genesisHash(secret: string, lotId: string): string {
  return hmac(secret, `genesis|${lotId}`);
}

export interface ChainedBid {
  lotId: string;
  seq: number;
  bidderId: string;
  amountCents: number;
  placedAt: Date;
  prevHash: string;
}

export function bidHash(secret: string, bid: ChainedBid): string {
  return hmac(secret, `v1|${bid.lotId}|${String(bid.seq)}|${bid.bidderId}|${String(bid.amountCents)}|${bid.placedAt.toISOString()}|${bid.prevHash}`);
}

export interface StoredBid extends ChainedBid {
  hash: string;
}

/** The lot's own copy of its head: the last bid's seq and hash, or 0 and null before any bid. */
export interface HeadCopy {
  seq: number;
  hash: string | null;
}

/**
 * The first seq where the bids stop being a valid chain: a bid out of place (a gap, a swap, an insert), one that does
 * not link to the hash before it (the first to the genesis), or one whose stored hash does not recompute.
 * The seq reported is the one expected at that place, so bids 1, 2, 4 give 3. Null when the chain holds.
 */
function firstChainBreak(secret: string, lotId: string, bids: StoredBid[]): number | null {
  let prevHash = genesisHash(secret, lotId);
  for (const [index, bid] of bids.entries()) {
    if (bid.seq !== index + 1 || bid.prevHash !== prevHash || bidHash(secret, bid) !== bid.hash) return index + 1;
    prevHash = bid.hash;
  }
  return null;
}

/** The first seq where the lot's head copy and the bids disagree, or null when the copy is the last bid. */
function firstHeadBreak(bids: StoredBid[], head: HeadCopy): number | null {
  const last = bids.at(-1);
  if (head.seq > bids.length) return bids.length + 1;
  if (head.seq < bids.length) return head.seq + 1;
  // Same seq on both sides: only the hash can differ. With no bids the expected seq is 1.
  return head.hash === (last?.hash ?? null) ? null : head.seq === 0 ? 1 : head.seq;
}

/**
 * The lowest seq at which the stored history and the lot's copy of the head disagree, or the chain check fails.
 * Null when the history is intact and the copy is its last bid. A seq above `head.seq` that the history holds
 * counts as a disagreement, and so does a head the history does not reach.
 */
export function firstBrokenSeq(secret: string, lotId: string, bids: StoredBid[], head: HeadCopy): number | null {
  const found = [firstChainBreak(secret, lotId, bids), firstHeadBreak(bids, head)].filter((seq) => seq !== null);
  return found.length === 0 ? null : Math.min(...found);
}

/** The name a bidder shows in a lot. Stable inside the lot, unlinkable across lots, and not the user id. */
export function pseudonymFor(secret: string, lotId: string, userId: string): string {
  return hmac(secret, `pseudonym|${lotId}|${userId}`).slice(0, 12);
}
