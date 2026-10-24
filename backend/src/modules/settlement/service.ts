import { randomBytes } from 'node:crypto';
import { databaseNow } from '../../shared/clock';
import type { Db, Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { isDue } from './rules';

interface LotRow {
  id: string;
  auctioneer_id: string;
  status: 'active' | 'cancelled';
  ends_at: Date;
  leader_id: string | null;
  current_amount_cents: number | null;
  head_seq: number;
  head_hash: string | null;
  settled_at: Date | null;
}

interface WalletRow {
  user_id: string;
  total_cents: number;
  committed_cents: number;
}

/**
 * Closes one lot. It runs in one transaction under the lot's row lock, so concurrent callers queue up:
 * the first one settles the lot, and the rest find `settled_at` set and do nothing.
 * Returns true only when this call settled the lot.
 */
export async function settleLot(db: Db, lotId: string): Promise<boolean> {
  return db.tx(async (tx) => {
    const [lot] = await tx.query<LotRow>(
      `select id, auctioneer_id, status, ends_at, leader_id, current_amount_cents, head_seq, head_hash, settled_at
       from public.lots where id = $1 for update`,
      [lotId],
    );
    if (!lot || lot.status !== 'active' || lot.settled_at !== null) return false;

    const now = await databaseNow(tx);
    if (!isDue(lot.ends_at, now)) return false;

    if (lot.leader_id === null || lot.current_amount_cents === null) {
      await tx.query("update public.lots set settled_at = $2, outcome = 'no_bids' where id = $1", [lotId, now]);
      return true;
    }

    await assertHeadMatchesChain(tx, lot, lot.leader_id, lot.current_amount_cents);

    // Wallets are locked in user-id order, the same order bidding uses, so the two cannot deadlock.
    const involved = [lot.leader_id, lot.auctioneer_id].sort();
    const wallets = await tx.query<WalletRow>(
      'select user_id, total_cents, committed_cents from public.wallets where user_id = any($1::uuid[]) order by user_id for update',
      [involved],
    );
    if (wallets.length !== involved.length) throw new AppError('not_found', 'Carteira não encontrada.');

    const amount = lot.current_amount_cents;
    await tx.query('update public.wallets set total_cents = total_cents - $2, committed_cents = committed_cents - $2 where user_id = $1', [lot.leader_id, amount]);
    await tx.query('update public.wallets set total_cents = total_cents + $2 where user_id = $1', [lot.auctioneer_id, amount]);

    await tx.query(
      `insert into public.wallet_ledger (user_id, kind, amount_cents, lot_id) values
         ($1, 'lot_debit', $3, $4),
         ($2, 'lot_credit', $5, $4)`,
      [lot.leader_id, lot.auctioneer_id, -amount, lotId, amount],
    );
    await tx.query(
      'insert into public.receipts (code, lot_id, winner_id, amount_cents, head_seq, head_hash, closed_at) values ($1, $2, $3, $4, $5, $6, $7)',
      [randomBytes(16).toString('hex'), lotId, lot.leader_id, amount, lot.head_seq, lot.head_hash, now],
    );
    await tx.query("update public.lots set settled_at = $2, outcome = 'sold' where id = $1", [lotId, now]);
    return true;
  });
}

/**
 * The lot keeps a copy of its head for speed. Before money moves, the copy must match the last bid
 * of the chain; if it does not, settlement stops rather than trusting the copy.
 */
async function assertHeadMatchesChain(tx: Queryable, lot: LotRow, leaderId: string, amountCents: number): Promise<void> {
  const [last] = await tx.query<{ seq: number; bidder_id: string; amount_cents: number; hash: string }>(
    'select seq, bidder_id, amount_cents, hash from public.bids where lot_id = $1 order by seq desc limit 1',
    [lot.id],
  );
  const matches =
    last !== undefined &&
    last.seq === lot.head_seq &&
    last.hash === lot.head_hash &&
    last.bidder_id === leaderId &&
    last.amount_cents === amountCents;
  if (!matches) throw new AppError('internal_error', 'O histórico do lote não confere com a cópia da ponta.');
}

/**
 * Settles every lot whose time has come. Each lot is its own transaction, so one failing lot does not
 * stop the others. A failure is logged and counted, never reported as a success.
 */
export async function settleDue(db: Db): Promise<{ settled: number; failed: number }> {
  const now = await databaseNow(db);
  const due = await db.query<{ id: string }>(
    "select id from public.lots where status = 'active' and settled_at is null and ends_at <= $1 order by ends_at",
    [now],
  );

  let settled = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      if (await settleLot(db, id)) settled += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : 'unexpected error';
      console.error(`settlement failed for lot ${id}: ${reason}`);
    }
  }
  return { settled, failed };
}
