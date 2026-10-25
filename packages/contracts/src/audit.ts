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

/**
 * Whether the head a bidder kept in a receipt is the hash of one of the lot's bids. It says only "found" or "not found":
 * a made-up or mistyped head gives the same answer as a bid that was removed, so it never accuses a lot by itself.
 */
export type ReceiptHeadResult = { status: 'in_history'; seq: number } | { status: 'not_in_history' };

/**
 * What the page may say about the lot as a whole (D22), decided here once so the words never claim more than was proven.
 * A lot-wide "intact" does not exist: the anchor cannot catch the removal of a last bid before its publication, and a
 * receipt proves only the bids up to its own seq.
 * - `tampered`: the chain is tampered or the anchor is divergent, whatever the receipt says.
 * - `unconfirmed`: a head was sent and was not found (never "tampered").
 * - `no_bids`: there is nothing to audit; `anchorUnverified` when the anchor could not be read or is off.
 * - `intact_until`: the chain is intact, the anchor is published and the receipt was found, up to its seq.
 * - `intact_chain_until`: as above, but the anchor is only published through `publishedThroughSeq`.
 * - `no_divergence_until`: no receipt was sent; nothing contradicts the history through `publishedThroughSeq` (0 means none published yet).
 * - `anchor_unverified`: the anchor could not be read, or is off; the chain and receipt results stand on their own.
 */
export type Headline =
  | { kind: 'tampered' }
  | { kind: 'unconfirmed' }
  | { kind: 'no_bids'; anchorUnverified: boolean }
  | { kind: 'intact_until'; seq: number }
  | { kind: 'intact_chain_until'; seq: number; publishedThroughSeq: number }
  | { kind: 'no_divergence_until'; publishedThroughSeq: number }
  | { kind: 'anchor_unverified' };

/** The public audit of a lot (D22). Read-only; every bid, oldest first. */
export interface AuditReport {
  lotId: string;
  bids: AuditBid[];
  chain: ChainResult;
  anchor: AnchorResult;
  /** Only when a `head` was sent. */
  receiptHead?: ReceiptHeadResult;
  headline: Headline;
}
