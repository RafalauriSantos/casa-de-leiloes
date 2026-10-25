import { randomBytes } from 'node:crypto';
import type { Config } from '../../config';
import { databaseNow } from '../../shared/clock';
import { firstBrokenSeq, type StoredBid } from '../../shared/bid-chain';
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
export async function settleLot(db: Db, config: Config, lotId: string): Promise<boolean> {
  return db.tx(async (tx) => {
    const [lot] = await tx.query<LotRow>(
      `select id, auctioneer_id, status, ends_at, leader_id, current_amount_cents, head_seq, head_hash, settled_at
       from public.lots where id = $1 for update`,
      [lotId],
    );
    if (!lot || lot.status !== 'active' || lot.settled_at !== null) return false;

    const now = await databaseNow(tx);
    if (!isDue(lot.ends_at, now)) return false;

    await assertHistoryIntact(tx, lot, config.auditHmacSecret);

    if (lot.leader_id === null || lot.current_amount_cents === null) {
      await tx.query("update public.lots set settled_at = $2, outcome = 'no_bids' where id = $1", [lotId, now]);
      return true;
    }

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
 * Before any money moves, the whole history must be intact: every bid links to the one before it and
 * every hash recomputes. The lot's head copy must then match the last bid. A lot with no leader must
 * have no history at all, so a lot cannot be closed as "no bids" while bids sit in the chain.
 */
async function assertHistoryIntact(tx: Queryable, lot: LotRow, secret: string): Promise<void> {
  const rows = await tx.query<{ seq: number; bidder_id: string; amount_cents: number; placed_at: Date; prev_hash: string; hash: string }>(
    'select seq, bidder_id, amount_cents, placed_at, prev_hash, hash from public.bids where lot_id = $1 order by seq',
    [lot.id],
  );
  const bids: StoredBid[] = rows.map((row) => ({
    lotId: lot.id,
    seq: row.seq,
    bidderId: row.bidder_id,
    amountCents: row.amount_cents,
    placedAt: row.placed_at,
    prevHash: row.prev_hash,
    hash: row.hash,
  }));
  const last = bids.at(-1);
  const headMatches =
    last === undefined
      ? lot.leader_id === null && lot.head_seq === 0 && lot.head_hash === null
      : lot.leader_id !== null && last.bidderId === lot.leader_id && last.amountCents === lot.current_amount_cents;
  if (!headMatches || firstBrokenSeq(secret, lot.id, bids, { seq: lot.head_seq, hash: lot.head_hash }) !== null) {
    throw new AppError('internal_error', 'O histórico do lote não confere com a cópia da ponta.');
  }
}

/**
 * Settles every lot whose time has come. Each lot is its own transaction, so one failing lot does not
 * stop the others. A failure is logged and counted, never reported as a success.
 */
export async function settleDue(db: Db, config: Config): Promise<{ settled: number; failed: number }> {
  const now = await databaseNow(db);
  const due = await db.query<{ id: string }>(
    "select id from public.lots where status = 'active' and settled_at is null and ends_at <= $1 order by ends_at",
    [now],
  );

  let settled = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      if (await settleLot(db, config, id)) settled += 1;
    } catch (error) {
      failed += 1;
      logFailure(id, error);
    }
  }
  return { settled, failed };
}

/**
 * Settles one lot when someone reads it or bids on it (D6), so a lot closes when it is looked at, not
 * only on the cron. A failure is logged and does not fail the reader: the lot is shown as ended either
 * way, and the cron keeps reporting the failure with HTTP 500.
 */
export async function settleIfEnded(db: Db, config: Config, lotId: string): Promise<void> {
  try {
    await settleLot(db, config, lotId);
  } catch (error) {
    logFailure(lotId, error);
  }
}

/** Settles the due lots a bidder leads, so reading the wallet releases the money no longer committed. */
export async function settleEndedLedBy(db: Db, config: Config, userId: string): Promise<void> {
  const now = await databaseNow(db);
  const due = await db.query<{ id: string }>(
    "select id from public.lots where leader_id = $1 and status = 'active' and settled_at is null and ends_at <= $2",
    [userId, now],
  );
  for (const { id } of due) await settleIfEnded(db, config, id);
}

function logFailure(lotId: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : 'unexpected error';
  console.error(`settlement failed for lot ${lotId}: ${reason}`);
}
