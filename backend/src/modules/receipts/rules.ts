import type { MyLotOutcome } from '@casa/contracts';

/** A receipt code is 128 random bits written as 32 lowercase hex characters (D10). */
export function isReceiptCode(code: string): boolean {
  return /^[0-9a-f]{32}$/.test(code);
}

export interface MyLotFacts {
  /** The lot's status column: anything but `active` means the lot was cancelled or released. */
  status: string;
  leaderId: string | null;
  endsAt: Date;
  /** The code of this bidder's receipt for the lot, when they won it. */
  receiptCode: string | null;
}

/**
 * Where a bidder stands in a lot at `now`. A lot that ended with this bidder in the lead and has no receipt yet is
 * `settling`: it becomes `won` when its settlement writes the receipt, and stays so while the chain is not published.
 */
export function outcomeOf(lot: MyLotFacts, bidderId: string, now: Date): MyLotOutcome {
  if (lot.receiptCode !== null) return 'won';
  if (lot.status !== 'active') return 'cancelled';
  if (lot.leaderId === bidderId) return now.getTime() < lot.endsAt.getTime() ? 'leading' : 'settling';
  return now.getTime() < lot.endsAt.getTime() ? 'outbid' : 'lost';
}
