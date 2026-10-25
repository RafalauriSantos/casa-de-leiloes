/** One bid of the public audit. No name, e-mail or user id: only the lot's pseudonym for the bidder. */
export interface AuditBid {
  seq: number;
  bidderLabel: string;
  amountCents: number;
  /** ISO time truncated to the second (D10); the hash covers the exact stored time, which the server checks. */
  placedAt: string;
  /** The bid's chain hash, 64 lowercase hex characters. The anchor repository publishes the same value. */
  hash: string;
}

/** The chain result: intact, or tampered with the first seq where the history and the lot's head copy disagree or the chain fails. */
export type ChainResult = { status: 'intact' } | { status: 'tampered'; brokenAtSeq: number };

/**
 * What the public anchor repository says about the lot (D22). `published`: every bid is in the file. `pending`: the file lacks
 * only the latest bids, and `stale` says the oldest of them has waited 10 minutes or more (an incident, not a normal wait).
 * `divergent`: the file contradicts the history, first at `atSeq` (null when the file itself is malformed). `unavailable`:
 * GitHub could not be read, so nothing is claimed. `off`: the anchor is not configured here.
 */
export type AnchorResult =
  | { status: 'published'; publishedThroughSeq: number }
  | { status: 'pending'; publishedThroughSeq: number; stale: boolean }
  | { status: 'divergent'; atSeq: number | null }
  | { status: 'unavailable' }
  | { status: 'off' };

/** The public audit of a lot (D22). Read-only; every bid, oldest first. */
export interface AuditReport {
  lotId: string;
  bids: AuditBid[];
  chain: ChainResult;
  anchor: AnchorResult;
}
