import type { AuditReport } from '@casa/contracts';
import type { Config } from '../../config';
import { firstBrokenSeq, pseudonymFor } from '../../shared/bid-chain';
import { readBids } from '../../shared/bid-history';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { chainResult, truncateToSecond } from './rules';

/**
 * The public audit of a lot: its bids, oldest first, and the chain result. The lot row and its bids are
 * read in one repeatable-read transaction, without locks, so a bid placed meanwhile cannot make the head
 * copy and the bids disagree and show a healthy lot as tampered. Only a lot that does not exist is a 404:
 * its status, bid count and head are fields that tampering can rewrite, and the audit must not trust them.
 */
export async function auditReport(db: Db, config: Config, lotId: string): Promise<AuditReport> {
  const { lot, bids } = await db.tx(async (tx) => {
    await tx.query('set transaction isolation level repeatable read');
    const [found] = await tx.query<{ head_seq: number; head_hash: string | null }>('select head_seq, head_hash from public.lots where id = $1', [lotId]);
    if (!found) throw new AppError('not_found', 'Lote não encontrado.');
    return { lot: found, bids: await readBids(tx, lotId) };
  });

  return {
    lotId,
    bids: bids.map((bid) => ({
      seq: bid.seq,
      bidderLabel: pseudonymFor(config.auditHmacSecret, lotId, bid.bidderId),
      amountCents: bid.amountCents,
      placedAt: truncateToSecond(bid.placedAt.toISOString()),
      hash: bid.hash,
    })),
    chain: chainResult(firstBrokenSeq(config.auditHmacSecret, lotId, bids, { seq: lot.head_seq, hash: lot.head_hash })),
  };
}
