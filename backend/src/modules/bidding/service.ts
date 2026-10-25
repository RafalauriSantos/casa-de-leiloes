import type { BidAccepted, BidReceipt, LiveLot } from '@casa/contracts';
import type { Config } from '../../config';
import { databaseNow } from '../../shared/clock';
import type { Db, Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { bidHash, genesisHash, pseudonymFor } from '../../shared/bid-chain';
import { decideBid } from './rules';
import { stateOf } from '../lots';

const HISTORY_LIMIT = 50;

interface LotRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: 'active' | 'cancelled';
  starting_bid_cents: number;
  increment_cents: number;
  current_amount_cents: number | null;
  leader_id: string | null;
  head_seq: number;
  head_hash: string | null;
}

interface BidRow {
  seq: number;
  bidder_id: string;
  amount_cents: number;
  placed_at: Date;
}

const LOT_COLUMNS = `id, starts_at, ends_at, status, starting_bid_cents, increment_cents,
  current_amount_cents, leader_id, head_seq, head_hash`;

/** The live room's view of a lot. Public; `position` only for a signed-in viewer. */
export async function liveView(db: Queryable, config: Config, lotId: string, viewerId: string | undefined): Promise<LiveLot> {
  const now = await databaseNow(db);
  const [lot] = await db.query<LotRow & { bid_count: number }>(`select ${LOT_COLUMNS}, bid_count from public.lots where id = $1 and status = 'active'`, [lotId]);
  if (!lot) throw new AppError('not_found', 'Lote não encontrado.');

  const history = await db.query<BidRow>(
    'select seq, bidder_id, amount_cents, placed_at from public.bids where lot_id = $1 order by seq desc limit $2',
    [lotId, HISTORY_LIMIT],
  );
  const labelOf = (bidderId: string) => pseudonymFor(config.auditHmacSecret, lotId, bidderId);
  const minimum = lot.current_amount_cents === null ? lot.starting_bid_cents : lot.current_amount_cents + lot.increment_cents;

  let position: LiveLot['position'];
  if (viewerId !== undefined) {
    if (lot.leader_id === viewerId) {
      position = 'leading';
    } else {
      // Asked of the whole history, not the window shown: an early bidder is still outbid.
      const [bidBefore] = await db.query<{ bid: boolean }>('select exists (select 1 from public.bids where lot_id = $1 and bidder_id = $2) as bid', [lotId, viewerId]);
      position = bidBefore?.bid ? 'outbid' : 'none';
    }
  }

  return {
    id: lot.id,
    state: stateOf({ startsAt: lot.starts_at, endsAt: lot.ends_at, cancelled: false }, now),
    serverNow: now.toISOString(),
    startsAt: lot.starts_at.toISOString(),
    endsAt: lot.ends_at.toISOString(),
    startingBidCents: lot.starting_bid_cents,
    incrementCents: lot.increment_cents,
    currentAmountCents: lot.current_amount_cents,
    nextMinimumCents: minimum,
    bidCount: lot.bid_count,
    leader: lot.leader_id === null ? null : labelOf(lot.leader_id),
    history: history.map((bid) => ({
      seq: bid.seq,
      bidderLabel: labelOf(bid.bidder_id),
      amountCents: bid.amount_cents,
      placedAt: bid.placed_at.toISOString(),
      mine: viewerId !== undefined && bid.bidder_id === viewerId,
    })),
    ...(position === undefined ? {} : { position }),
  };
}

/**
 * Places one bid. Lock order is fixed to avoid deadlocks: the lot first, then the wallets involved,
 * in user-id order. The clock is read after the locks, so a bid cannot be judged against a stale time.
 */
export async function placeBid(db: Db, config: Config, bidderId: string, lotId: string, amountCents: number): Promise<BidAccepted> {
  const receipt: BidReceipt = await db.tx(async (tx) => {
    const [lot] = await tx.query<LotRow>(`select ${LOT_COLUMNS} from public.lots where id = $1 for update`, [lotId]);
    if (!lot) throw new AppError('not_found', 'Lote não encontrado.');

    const involved = [bidderId, lot.leader_id].filter((id): id is string => id !== null);
    const wallets = await tx.query<{ user_id: string; total_cents: number; committed_cents: number }>(
      'select user_id, total_cents, committed_cents from public.wallets where user_id = any($1::uuid[]) order by user_id for update',
      [[...new Set(involved)].sort()],
    );
    const mine = wallets.find((w) => w.user_id === bidderId);
    if (!mine) throw new AppError('not_found', 'Carteira não encontrada.');

    const now = await databaseNow(tx);
    const verdict = decideBid(
      {
        startsAt: lot.starts_at,
        endsAt: lot.ends_at,
        cancelled: lot.status === 'cancelled',
        startingBidCents: lot.starting_bid_cents,
        incrementCents: lot.increment_cents,
        currentAmountCents: lot.current_amount_cents,
        leaderId: lot.leader_id,
        bidCount: lot.head_seq,
      },
      { totalCents: mine.total_cents, committedCents: mine.committed_cents },
      { bidderId, amountCents },
      now,
    );
    if (!verdict.ok) throw new AppError(verdict.code, verdict.message);

    if (verdict.releasedLeaderId !== null) {
      await tx.query('update public.wallets set committed_cents = committed_cents - $2 where user_id = $1', [verdict.releasedLeaderId, verdict.releasedCents]);
    }
    await tx.query('update public.wallets set committed_cents = committed_cents + $2 where user_id = $1', [bidderId, amountCents]);

    const seq = lot.head_seq + 1;
    const prevHash = lot.head_hash ?? genesisHash(config.auditHmacSecret, lotId);
    const hash = bidHash(config.auditHmacSecret, { lotId, seq, bidderId, amountCents, placedAt: now, prevHash });
    await tx.query(
      'insert into public.bids (lot_id, seq, bidder_id, amount_cents, placed_at, prev_hash, hash) values ($1, $2, $3, $4, $5, $6, $7)',
      [lotId, seq, bidderId, amountCents, now, prevHash, hash],
    );
    await tx.query(
      `update public.lots set current_amount_cents = $2, leader_id = $3, bid_count = bid_count + 1,
              head_seq = $4, head_hash = $5, ends_at = $6 where id = $1`,
      [lotId, amountCents, bidderId, seq, hash, verdict.newEndsAt],
    );
    return { seq, head: hash, placedAt: now.toISOString() };
  });
  return { ...(await liveView(db, config, lotId, bidderId)), receipt };
}

