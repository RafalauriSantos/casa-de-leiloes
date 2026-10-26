/** Where a bidder stands in a lot they bid on. `won` comes with the receipt code; the others have none. */
export type MyLotOutcome = 'won' | 'lost' | 'leading' | 'settling' | 'outbid' | 'cancelled';

/** One lot in "Meus arremates": a lot the signed-in bidder bid on. */
export interface MyLot {
  lotId: string;
  title: string;
  imageUrl: string;
  endsAt: string;
  outcome: MyLotOutcome;
  /** The highest amount this bidder offered in the lot. */
  myBestCents: number;
  /** The lot's current or final amount. */
  amountCents: number | null;
  receiptCode: string | null;
}

/** The win receipt, public to whoever holds its random code. It names the winner by pseudonym only. */
export interface ReceiptView {
  code: string;
  lotId: string;
  lotTitle: string;
  imageUrl: string;
  amountCents: number;
  closedAt: string;
  winnerLabel: string;
  headSeq: number;
  headHash: string;
}
