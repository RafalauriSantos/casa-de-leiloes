import type { StoredBid } from './bid-chain';
import type { Queryable } from './db';

/**
 * The bids of a lot as the chain check needs them, oldest first. The one place that reads them, so settlement,
 * the publisher and the audit cannot read them differently.
 *
 * `placed_at` holds microseconds, but the hash covers the time to the millisecond and node-postgres keeps only
 * that. A time with a finer part was not written by the bid path (it stores a JavaScript date), and reading it
 * as a date would hide a change of a few microseconds, so the query reports whether the time is exact.
 */
export async function readBids(db: Queryable, lotId: string): Promise<StoredBid[]> {
  const rows = await db.query<{
    seq: number;
    bidder_id: string;
    amount_cents: number;
    placed_at: Date;
    time_exact: boolean;
    prev_hash: string;
    hash: string;
  }>(
    `select seq, bidder_id, amount_cents, placed_at, placed_at = date_trunc('milliseconds', placed_at) as time_exact, prev_hash, hash
     from public.bids where lot_id = $1 order by seq`,
    [lotId],
  );
  return rows.map((row) => ({
    lotId,
    seq: row.seq,
    bidderId: row.bidder_id,
    amountCents: row.amount_cents,
    placedAt: row.placed_at,
    timeExact: row.time_exact,
    prevHash: row.prev_hash,
    hash: row.hash,
  }));
}
