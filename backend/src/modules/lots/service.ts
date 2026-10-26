import type { AuctioneerSummary, ItemAttributes, LotDetail, LotState, LotSummary, OwnLot, LotInput } from '@casa/contracts';
import type { Config } from '../../config';
import { databaseNow } from '../../shared/clock';
import { type Db, type Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { fetchItem } from '../catalog';
import { verifiedLead } from '../settlement';
import { cancelRefusal, checkTiming, editRefusal, resultOf, stateOf } from './rules';
import type { createLotInput, lotsQuery } from './schemas';
import type { z } from 'zod';

const SHOWCASE_LIMIT = 60;

interface LotRow {
  id: string;
  auctioneer_id: string;
  title: string;
  item_image_url: string;
  item_source_url: string;
  item_attributes: ItemAttributes;
  starts_at: Date;
  ends_at: Date;
  starting_bid_cents: number;
  increment_cents: number;
  status: 'active' | 'cancelled' | 'integrity_cancelled';
  bid_count: number;
  settled_at: Date | null;
  outcome: 'sold' | 'no_bids' | null;
  current_amount_cents: number | null;
}

const COLUMNS = `id, auctioneer_id, title, item_image_url, item_source_url, item_attributes,
  starts_at, ends_at, starting_bid_cents, increment_cents, status, bid_count, settled_at, outcome, current_amount_cents`;

const stateFor = (row: LotRow, now: Date): LotState =>
  // Any status other than active is shown as cancelled: a lot released by the owner for tampering (D20) has no sale.
  stateOf({ startsAt: row.starts_at, endsAt: row.ends_at, cancelled: row.status !== 'active' }, now);

function toSummary(row: LotRow, now: Date): LotSummary {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.item_image_url,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    startingBidCents: row.starting_bid_cents,
    incrementCents: row.increment_cents,
    state: stateFor(row, now),
    currentAmountCents: row.current_amount_cents,
  };
}

function toDetail(row: LotRow, now: Date): LotDetail {
  return { ...toSummary(row, now), sourceUrl: row.item_source_url, attributes: row.item_attributes };
}

function toOwn(row: LotRow, now: Date): OwnLot {
  const state = { state: stateFor(row, now), bidCount: row.bid_count };
  return {
    ...toDetail(row, now),
    bidCount: row.bid_count,
    canEdit: editRefusal(state) === undefined,
    canCancel: cancelRefusal(state) === undefined,
    result: resultOf({ state: state.state, settled: row.settled_at !== null, outcome: row.outcome, amountCents: row.current_amount_cents }),
  };
}

/** Escapes the LIKE wildcards so a search for "100%" finds that text, not everything. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

export async function listPublicLots(db: Queryable, query: z.infer<typeof lotsQuery>): Promise<LotSummary[]> {
  const now = await databaseNow(db);
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };
  const clauses = ["status = 'active'"];
  if (query.q) clauses.push(`title ilike ${bind(`%${escapeLike(query.q)}%`)}`);
  if (query.status === 'live') clauses.push(`starts_at <= ${bind(now)} and ends_at > ${bind(now)}`);
  if (query.status === 'scheduled') clauses.push(`starts_at > ${bind(now)}`);
  if (query.status === 'ended') clauses.push(`ends_at <= ${bind(now)}`);
  // Ended lots go last in the unfiltered list, so they can never push live and scheduled lots out of
  // the first page. The ended tab shows the most recently ended first.
  const order = query.status === 'ended'
    ? 'ends_at desc'
    : `(ends_at <= ${bind(now)}) asc, ends_at asc`;
  const rows = await db.query<LotRow>(
    `select ${COLUMNS} from public.lots where ${clauses.join(' and ')} order by ${order} limit ${String(SHOWCASE_LIMIT)}`,
    params,
  );
  return rows.map((row) => toSummary(row, now));
}

export async function getPublicLot(db: Queryable, id: string): Promise<LotDetail> {
  const now = await databaseNow(db);
  const [row] = await db.query<LotRow>(`select ${COLUMNS} from public.lots where id = $1 and status = 'active'`, [id]);
  if (!row) throw new AppError('not_found', 'Lote não encontrado.');
  return toDetail(row, now);
}

export async function listOwnLots(db: Queryable, userId: string): Promise<OwnLot[]> {
  const now = await databaseNow(db);
  const rows = await db.query<LotRow>(`select ${COLUMNS} from public.lots where auctioneer_id = $1 order by created_at desc`, [userId]);
  return rows.map((row) => toOwn(row, now));
}

/** The item is fetched by the server now and copied into the lot. If the catalog fails, nothing is written. */
export async function createLot(db: Db, config: Config, userId: string, input: z.infer<typeof createLotInput>): Promise<OwnLot> {
  const now = await databaseNow(db);
  const timing = checkTiming(new Date(input.startsAt), new Date(input.endsAt), now);
  if (timing) throw new AppError('validation_error', timing);
  const item = await fetchItem(config.metApiUrl, input.externalId);
  // The catalog call can take seconds: the clock is read again, so a lot that has started meanwhile is refused.
  const writtenAt = await databaseNow(db);
  const late = checkTiming(new Date(input.startsAt), new Date(input.endsAt), writtenAt);
  if (late) throw new AppError('validation_error', late);

  // The start is checked again inside the insert: the row is written only if the start is still ahead.
  const rows = await db.query<LotRow>(
    `insert into public.lots (auctioneer_id, external_id, title, item_image_url, item_source_url, item_attributes,
                              starts_at, ends_at, starting_bid_cents, increment_cents)
     select $1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9, $10
      where $7::timestamptz > clock_timestamp()
     returning ${COLUMNS}`,
    [userId, input.externalId, input.title, item.imageUrl, item.sourceUrl, JSON.stringify(item.attributes),
      input.startsAt, input.endsAt, input.startingBidCents, input.incrementCents],
  );
  const [row] = rows;
  if (!row) throw new AppError('validation_error', 'O lote precisa começar no futuro.');
  return toOwn(row, writtenAt);
}

/** Loads a lot the caller owns, locked for the rest of the transaction. */
async function ownedLotForUpdate(tx: Queryable, userId: string, lotId: string): Promise<LotRow> {
  const [row] = await tx.query<LotRow>(`select ${COLUMNS} from public.lots where id = $1 for update`, [lotId]);
  if (!row) throw new AppError('not_found', 'Lote não encontrado.');
  if (row.auctioneer_id !== userId) throw new AppError('forbidden', 'Este lote pertence a outro leiloeiro.');
  return row;
}

export async function updateLot(db: Db, userId: string, lotId: string, input: LotInput): Promise<OwnLot> {
  return db.tx(async (tx) => {
    const current = await ownedLotForUpdate(tx, userId, lotId);
    const now = await databaseNow(tx);
    const refusal = editRefusal({ state: stateFor(current, now), bidCount: current.bid_count });
    if (refusal) throw new AppError(refusal.code, refusal.message);
    const timing = checkTiming(new Date(input.startsAt), new Date(input.endsAt), now);
    if (timing) throw new AppError('validation_error', timing);

    const [row] = await tx.query<LotRow>(
      `update public.lots set title = $2, starts_at = $3, ends_at = $4, starting_bid_cents = $5, increment_cents = $6
       where id = $1 returning ${COLUMNS}`,
      [lotId, input.title, input.startsAt, input.endsAt, input.startingBidCents, input.incrementCents],
    );
    if (!row) throw new Error('lot update returned no row');
    return toOwn(row, now);
  });
}

export async function cancelLot(db: Db, config: Config, userId: string, lotId: string): Promise<OwnLot> {
  return db.tx(async (tx) => {
    const current = await ownedLotForUpdate(tx, userId, lotId);
    const now = await databaseNow(tx);
    const refusal = cancelRefusal({ state: stateFor(current, now) });
    if (refusal) throw new AppError(refusal.code, refusal.message);

    // B19: the leader's committed money goes back to available in this transaction; outbid bidders were released when
    // they were outbid. The lot row is already locked, so the wallet is locked after it: the order bidding uses.
    // As before a payment, the history must verify and the lot's copy of its leader and amount must match it; and the
    // wallet must still cover this lot plus the other lots the leader leads, so a refund never frees their money (D25).
    if (current.bid_count > 0) {
      const lead = await verifiedLead(tx, lotId, config.auditHmacSecret);
      const [wallet] = await tx.query<{ committed_cents: number }>('select committed_cents from public.wallets where user_id = $1 for update', [lead.leaderId]);
      const [others] = await tx.query<{ amount: number }>(
        `select coalesce(sum(current_amount_cents), 0)::bigint as amount from public.lots
         where leader_id = $1 and status = 'active' and settled_at is null and id <> $2`,
        [lead.leaderId, lotId],
      );
      if (!wallet || wallet.committed_cents < lead.amountCents + (others?.amount ?? 0)) {
        throw new AppError('internal_error', 'O dinheiro comprometido de quem lidera não cobre este lote; o cancelamento foi recusado.');
      }
      await tx.query('update public.wallets set committed_cents = committed_cents - $2 where user_id = $1', [lead.leaderId, lead.amountCents]);
    }
    await tx.query("update public.lots set status = 'cancelled' where id = $1", [lotId]);
    return toOwn({ ...current, status: 'cancelled' }, now);
  });
}

/** What this auctioneer received in total, from the win receipts of their own lots, and how many lots ended (1.7). */
export async function auctioneerSummary(db: Queryable, userId: string): Promise<AuctioneerSummary> {
  const [row] = await db.query<{ total: number; sold: number; ended: number }>(
    `select coalesce((select sum(r.amount_cents) from public.receipts r join public.lots l on l.id = r.lot_id
                       where l.auctioneer_id = $1), 0)::bigint as total,
            (select count(*)::int from public.receipts r join public.lots l on l.id = r.lot_id where l.auctioneer_id = $1) as sold,
            (select count(*)::int from public.lots where auctioneer_id = $1 and outcome is not null) as ended`,
    [userId],
  );
  if (!row) throw new Error('auctioneer summary query returned no row');
  return { totalReceivedCents: row.total, soldLots: row.sold, endedLots: row.ended };
}
