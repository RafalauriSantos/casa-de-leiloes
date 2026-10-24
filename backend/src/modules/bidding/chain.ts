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

/** The name a bidder shows in a lot. Stable inside the lot, unlinkable across lots, and not the user id. */
export function pseudonymFor(secret: string, lotId: string, userId: string): string {
  return hmac(secret, `pseudonym|${lotId}|${userId}`).slice(0, 12);
}
