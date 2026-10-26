import type { MyLot, ReceiptView } from '@casa/contracts';
import type { Config } from '../../config';
import { pseudonymFor } from '../../shared/bid-chain';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { isReceiptCode, outcomeOf } from './rules';

/** The most recent lots a bidder bid on that "Meus arremates" shows. */
const MY_LOTS_LIMIT = 100;

interface MyLotRow {
  id: string;
  title: string;
  item_image_url: string;
  ends_at: Date;
  status: string;
  leader_id: string | null;
  current_amount_cents: number | null;
  my_best: number;
  receipt_code: string | null;
  now: Date;
}

/** The lots this bidder bid on: won lots first, then newest bid first, each with where they stand and, when they won, the receipt code. */
export async function listMyLots(db: Db, bidderId: string): Promise<MyLot[]> {
  const rows = await db.query<MyLotRow>(
    `select l.id, l.title, l.item_image_url, l.ends_at, l.status, l.leader_id, l.current_amount_cents,
            max(b.amount_cents)::bigint as my_best, r.code as receipt_code, clock_timestamp() as now
       from public.bids b
       join public.lots l on l.id = b.lot_id
       left join public.receipts r on r.lot_id = l.id and r.winner_id = $1
      where b.bidder_id = $1
      group by l.id, r.code
      order by (r.code is not null) desc, max(b.placed_at) desc
      limit ${String(MY_LOTS_LIMIT)}`,
    [bidderId],
  );
  return rows.map((row) => ({
    lotId: row.id,
    title: row.title,
    imageUrl: row.item_image_url,
    endsAt: row.ends_at.toISOString(),
    outcome: outcomeOf({ status: row.status, leaderId: row.leader_id, endsAt: row.ends_at, receiptCode: row.receipt_code }, bidderId, row.now),
    myBestCents: row.my_best,
    amountCents: row.current_amount_cents,
    receiptCode: row.receipt_code,
  }));
}

interface ReceiptRow {
  code: string;
  lot_id: string;
  winner_id: string;
  amount_cents: number;
  closed_at: Date;
  head_seq: number;
  head_hash: string;
  title: string;
  item_image_url: string;
}

/** The win receipt behind a code. Anyone holding the code may read it; it names the winner by pseudonym only. */
export async function getReceipt(db: Db, config: Config, code: string): Promise<ReceiptView> {
  const notFound = new AppError('not_found', 'Comprovante não encontrado.');
  if (!isReceiptCode(code)) throw notFound;
  const [row] = await db.query<ReceiptRow>(
    `select r.code, r.lot_id, r.winner_id, r.amount_cents, r.closed_at, r.head_seq, r.head_hash, l.title, l.item_image_url
       from public.receipts r
       join public.lots l on l.id = r.lot_id
      where r.code = $1`,
    [code],
  );
  if (!row) throw notFound;
  return {
    code: row.code,
    lotId: row.lot_id,
    lotTitle: row.title,
    imageUrl: row.item_image_url,
    amountCents: row.amount_cents,
    closedAt: row.closed_at.toISOString(),
    winnerLabel: pseudonymFor(config.auditHmacSecret, row.lot_id, row.winner_id),
    headSeq: row.head_seq,
    headHash: row.head_hash,
  };
}
