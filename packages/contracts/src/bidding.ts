import type { LotState } from './lots';

export interface BidEntry {
  seq: number;
  /** A stable pseudonym inside the lot: never the user's id or name. */
  bidderLabel: string;
  amountCents: number;
  placedAt: string;
  /** True for the signed-in viewer's own bids. */
  mine: boolean;
}

/** The live room. Times are ISO strings; `serverNow` is the database clock, so countdowns use the server's time. */
export interface LiveLot {
  id: string;
  state: LotState;
  serverNow: string;
  startsAt: string;
  endsAt: string;
  startingBidCents: number;
  incrementCents: number;
  currentAmountCents: number | null;
  nextMinimumCents: number;
  bidCount: number;
  leader: string | null;
  /** Most recent bids first, at most 50. */
  history: BidEntry[];
  /** Only for a signed-in viewer: leading, outbid, or none. */
  position?: 'leading' | 'outbid' | 'none';
}
