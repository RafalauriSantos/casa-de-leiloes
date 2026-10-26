import { randomBytes } from 'node:crypto';
import type { Config } from '../../config';
import { databaseNow } from '../../shared/clock';
import { firstBrokenSeq } from '../../shared/bid-chain';
import { readBids } from '../../shared/bid-history';
import type { Db, Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { isDue, mustWaitForAnchor } from './rules';

interface LotRow {
  id: string;
  auctioneer_id: string;
  status: 'active' | 'cancelled' | 'integrity_cancelled';
  ends_at: Date;
  leader_id: string | null;
  current_amount_cents: number | null;
  head_seq: number;
  head_hash: string | null;
  anchored_seq: number;
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
  // A cheap look first, with no lock and no chain check: a lot page is read every few seconds, and most of those reads find
  // nothing to do (the lot is not over, already settled, cancelled, or waiting for its publication). Only a lot that may be
  // settled takes the lock below, which judges it again, so this look can only skip work that would have done nothing.
  const [peek] = await db.query<{ status: string; settled_at: Date | null; due: boolean; head_seq: number; anchored_seq: number }>(
    'select status, settled_at, ends_at <= clock_timestamp() as due, head_seq, anchored_seq from public.lots where id = $1',
    [lotId],
  );
  if (!peek || peek.status !== 'active' || peek.settled_at !== null || !peek.due) return false;
  if (mustWaitForAnchor({ anchorMode: config.anchor.mode, anchoredSeq: peek.anchored_seq, headSeq: peek.head_seq })) return false;

  return db.tx(async (tx) => {
    const [lot] = await tx.query<LotRow>(
      `select id, auctioneer_id, status, ends_at, leader_id, current_amount_cents, head_seq, head_hash, anchored_seq, settled_at
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

    // D21, option B. The look above already sent a waiting lot away; this judges it again under the lock, as defence in depth for
    // the money path (the look reads without a lock). For a lot that reaches here, the history is known to be intact first.
    // Waiting is not a failure: the next run tries again.
    if (mustWaitForAnchor({ anchorMode: config.anchor.mode, anchoredSeq: lot.anchored_seq, headSeq: lot.head_seq })) return false;

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
  const bids = await readBids(tx, lot.id);
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
 * The same check for money that moves outside the settlement: cancelling a lot refunds its leader (B19, D25). The
 * caller has locked the lot. Returns the leader and the amount, which then agree with the verified chain, or null when
 * the verified history has no bids. The answer comes from the bids, never from the lot's `bid_count` copy.
 */
export async function verifiedLead(tx: Queryable, lotId: string, secret: string): Promise<{ leaderId: string; amountCents: number } | null> {
  const [lot] = await tx.query<LotRow>(
    `select id, auctioneer_id, status, ends_at, leader_id, current_amount_cents, head_seq, head_hash, anchored_seq, settled_at
     from public.lots where id = $1`,
    [lotId],
  );
  if (!lot) throw new AppError('not_found', 'Lote não encontrado.');
  await assertHistoryIntact(tx, lot, secret);
  // An intact history with no bids has no leader (assertHistoryIntact checks it); with bids, the copy matches the last one.
  if (lot.leader_id === null || lot.current_amount_cents === null) return null;
  return { leaderId: lot.leader_id, amountCents: lot.current_amount_cents };
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
