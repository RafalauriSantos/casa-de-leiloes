import type { AuditReport } from '@casa/contracts';
import type { Config } from '../../config';
import { firstBrokenSeq, pseudonymFor, type StoredBid } from '../../shared/bid-chain';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { chainResult, truncateToSecond } from './rules';

interface BidRow {
  seq: number;
  bidder_id: string;
  amount_cents: number;
  placed_at: Date;
  prev_hash: string;
  hash: string;
}

/**
 * The public audit of a lot: its bids, oldest first, and the chain result. The lot row and its bids are
 * read in one repeatable-read transaction, without locks, so a bid placed meanwhile cannot make the head
 * copy and the bids disagree and show a healthy lot as tampered. Only a lot that does not exist is a 404:
 * its status, bid count and head are fields that tampering can rewrite, and the audit must not trust them.
 */
export async function auditReport(db: Db, config: Config, lotId: string): Promise<AuditReport> {
  const { lot, rows } = await db.tx(async (tx) => {
    await tx.query('set transaction isolation level repeatable read');
    const [found] = await tx.query<{ head_seq: number; head_hash: string | null }>('select head_seq, head_hash from public.lots where id = $1', [lotId]);
    if (!found) throw new AppError('not_found', 'Lote não encontrado.');
    const bids = await tx.query<BidRow>('select seq, bidder_id, amount_cents, placed_at, prev_hash, hash from public.bids where lot_id = $1 order by seq', [lotId]);
    return { lot: found, rows: bids };
  });

  const stored: StoredBid[] = rows.map((row) => ({
    lotId,
    seq: row.seq,
    bidderId: row.bidder_id,
    amountCents: row.amount_cents,
    placedAt: row.placed_at,
    prevHash: row.prev_hash,
    hash: row.hash,
  }));
  return {
    lotId,
    bids: rows.map((row) => ({
      seq: row.seq,
      bidderLabel: pseudonymFor(config.auditHmacSecret, lotId, row.bidder_id),
      amountCents: row.amount_cents,
      placedAt: truncateToSecond(row.placed_at.toISOString()),
      hash: row.hash,
    })),
    chain: chainResult(firstBrokenSeq(config.auditHmacSecret, lotId, stored, { seq: lot.head_seq, hash: lot.head_hash })),
  };
}
