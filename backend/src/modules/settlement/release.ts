import { AppError } from '../../shared/errors';
import { firstBrokenSeq, type HeadCopy } from '../../shared/bid-chain';
import { readBids } from '../../shared/bid-history';
import { databaseNow } from '../../shared/clock';
import type { Config } from '../../config';
import type { Db, Queryable } from '../../shared/db';

/**
 * The reference that checks the secret in use: the latest sold lot with bids, verified with the configured secret.
 * `broken` means that lot does not verify with this secret, so the secret is the suspect, not the lot. `none` means there
 * is no sold lot to compare with yet. Read inside the release's transaction, so it is judged under the same lock.
 */
export async function referenceOf(q: Queryable, config: Config): Promise<'verified' | 'broken' | 'none'> {
  // A few of the latest sold lots: one that verifies proves the secret, so a single altered sold lot cannot block every release.
  const settled = await q.query<{ id: string }>("select id from public.lots where outcome = 'sold' and head_seq > 0 order by settled_at desc limit 5");
  if (settled.length === 0) return 'none';
  for (const lot of settled) {
    const bids = await readBids(q, lot.id);
    const [head] = await q.query<{ head_seq: number; head_hash: string | null }>('select head_seq, head_hash from public.lots where id = $1', [lot.id]);
    if (firstBrokenSeq(config.auditHmacSecret, lot.id, bids, { seq: head?.head_seq ?? 0, hash: head?.head_hash ?? null }) === null) return 'verified';
  }
  return 'broken';
}

export interface ReleaseInput {
  /** Who decided: the owner's name, written down with the decision (1 to 80 characters). */
  decidedBy: string;
  /** Why: what was found, in words a person can read later (1 to 500 characters). */
  reason: string;
  /**
   * The leader and the amount to free, as the owner reads them. A tampered lot can have altered either its own copy or the
   * bids, so nothing is trusted alone: each value must be one of the two sources, and the leader's committed money must cover it.
   */
  leaderId: string | null;
  amountCents: number;
}

export interface ReleaseResult {
  releasedCents: number;
  leaderId: string | null;
  /** The first broken seq, or 0 when the chain verifies and only the lot's copy disagrees with its last bid. */
  brokenAtSeq: number;
}

interface LotRow {
  status: string;
  ends_at: Date;
  settled_at: Date | null;
  leader_id: string | null;
  current_amount_cents: number | null;
  head_seq: number;
  head_hash: string | null;
}

const MAX_DECIDED_BY = 80;
const MAX_REASON = 500;

/**
 * D20: releases the money committed on a lot whose history fails verification. Run by the system owner with the
 * privileged connection, never by the API. One transaction, under the lot's row lock (then the leader's wallet, the same
 * order bidding uses): the leader's committed money goes back to the available balance, the lot becomes `integrity_cancelled`,
 * and one append-only row records the decision. Nobody is paid and no ledger row is written.
 */
export async function releaseTamperedLot(db: Db, config: Config, lotId: string, input: ReleaseInput): Promise<ReleaseResult> {
  const decidedBy = input.decidedBy.trim();
  const reason = input.reason.trim();
  if (decidedBy === '' || reason === '') throw new AppError('validation_error', 'Informe quem decidiu e o motivo.');
  if (decidedBy.length > MAX_DECIDED_BY) throw new AppError('validation_error', `Quem decidiu: até ${String(MAX_DECIDED_BY)} caracteres.`);
  if (reason.length > MAX_REASON) throw new AppError('validation_error', `O motivo: até ${String(MAX_REASON)} caracteres.`);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) throw new AppError('validation_error', 'O valor a liberar deve ser um número inteiro de centavos.');

  return db.tx(async (tx) => {
    const [lot] = await tx.query<LotRow>(
      `select status, ends_at, settled_at, leader_id, current_amount_cents, head_seq, head_hash
       from public.lots where id = $1 for update`,
      [lotId],
    );
    if (!lot) throw new AppError('not_found', 'Lote não encontrado.');
    if (lot.status !== 'active' || lot.settled_at !== null) {
      throw new AppError('validation_error', 'Só um lote ativo e ainda não liquidado pode ser liberado.');
    }
    // The owner decides once the lot's time is over: a release mid-auction would cancel bidders who can still bid.
    const now = await databaseNow(tx);
    if (now.getTime() < lot.ends_at.getTime()) throw new AppError('validation_error', 'O lote ainda não encerrou: a liberação só vale depois do fim.');

    const bids = await readBids(tx, lotId);
    // The secret must verify a sold lot before any money moves: a wrong secret would call a healthy lot tampered.
    if (await referenceOf(tx, config) === 'broken') {
      throw new AppError('validation_error', 'Nenhuma das últimas liquidações confere com o segredo em uso: o segredo ou essas liquidações foram alterados. Nada foi liberado.');
    }
    // A lot with no bids and no head has no committed money: the settlement closes it, the owner has nothing to free.
    if (bids.length === 0 && lot.head_seq === 0 && lot.head_hash === null && lot.leader_id === null) {
      throw new AppError('validation_error', 'Lote sem lances: não há dinheiro comprometido a liberar; a liquidação o fecha.');
    }
    const head: HeadCopy = { seq: lot.head_seq, hash: lot.head_hash };
    const brokenAtSeq = firstBrokenSeq(config.auditHmacSecret, lotId, bids, head);
    // The two sources the owner chose between: the lot's own copy, and the last stored bid. The leader and the amount are one
    // pair: each source is a pair, and the owner's answer must be one of them. A leader with zero, or an amount with no
    // leader, is never a release.
    const last = bids.at(-1);
    // Settlement also refuses a lot whose copy of the leader or amount disagrees with its last bid, even when the chain verifies:
    // such a lot is releasable too, so a copy-only alteration cannot hold money for ever.
    const copyDisagrees = last === undefined
      ? lot.leader_id !== null || lot.current_amount_cents !== null
      : lot.leader_id !== last.bidderId || lot.current_amount_cents !== last.amountCents;
    if (brokenAtSeq === null && !copyDisagrees) throw new AppError('validation_error', 'O histórico deste lote confere: não há o que liberar.');

    if ((input.leaderId === null) !== (input.amountCents === 0)) {
      throw new AppError('validation_error', 'Um líder sem valor, ou um valor sem líder, não é uma liberação.');
    }
    // Each source is one pair only when its own fields agree: a copy whose amount is missing names no pair, it does not
    // become (leader, 0).
    const pairs: [string | null, number][] = [];
    // A copy with no leader and no amount is the empty pair only when there are no bids: with bids, the last bid holds the money.
    if (lot.leader_id === null && lot.current_amount_cents === null && last === undefined) pairs.push([null, 0]);
    if (lot.leader_id !== null && lot.current_amount_cents !== null) pairs.push([lot.leader_id, lot.current_amount_cents]);
    if (last !== undefined) pairs.push([last.bidderId, last.amountCents]);
    if (!pairs.some(([leader, amount]) => leader === input.leaderId && amount === input.amountCents)) {
      throw new AppError('validation_error', 'O líder e o valor informados não conferem, juntos, com a cópia do lote nem com o último lance: a liberação foi recusada.');
    }
    if (input.leaderId !== null) {
      const [wallet] = await tx.query<{ committed_cents: number }>('select committed_cents from public.wallets where user_id = $1 for update', [input.leaderId]);
      // The wallet's committed money is shared by every lot it leads: what this lot frees must not touch the others (D5).
      const [others] = await tx.query<{ amount: number }>(
        `select coalesce(sum(current_amount_cents), 0)::bigint as amount from public.lots
         where leader_id = $1 and status = 'active' and settled_at is null and id <> $2`,
        [input.leaderId, lotId],
      );
      if (!wallet || wallet.committed_cents < input.amountCents + (others?.amount ?? 0)) {
        throw new AppError('internal_error', 'O dinheiro comprometido do líder não cobre este lote e os outros que ele lidera: a liberação foi recusada.');
      }
      await tx.query('update public.wallets set committed_cents = committed_cents - $2 where user_id = $1', [input.leaderId, input.amountCents]);
    }

    await tx.query(
      `insert into public.integrity_decisions (lot_id, decided_by, reason, broken_seq, leader_id, released_cents)
       values ($1, $2, $3, $4, $5, $6)`,
      [lotId, decidedBy, reason, brokenAtSeq ?? 0, input.leaderId, input.amountCents],
    );
    await tx.query("update public.lots set status = 'integrity_cancelled' where id = $1", [lotId]);
    return { releasedCents: input.amountCents, leaderId: input.leaderId, brokenAtSeq: brokenAtSeq ?? 0 };
  });
}

/** The facts the owner reads before answering the release script: what the system sees, and whether a release can be made. */
export interface LotReview {
  lotId: string;
  status: string;
  copy: { leaderId: string | null; amountCents: number | null };
  last: { seq: number; leaderId: string; amountCents: number } | null;
  headSeq: number;
  brokenAtSeq: number | null;
  copyDisagrees: boolean;
  /** `verified` when one of the latest sold lots verifies with the secret in use; `broken` when none does (the secret or those lots may be altered); `none` when there is no sold lot to compare. */
  reference: 'verified' | 'broken' | 'none';
  decidable: boolean;
  /** Why a release cannot be made, in words for the owner (empty when it can). */
  reason: string;
}

/** Reads a lot the way the release reads it, without writing anything. Null when the lot does not exist. */
export async function reviewTamperedLot(db: Db, config: Config, lotId: string): Promise<LotReview | null> {
  const [lot] = await db.query<LotRow & { id: string }>(
    'select id, status, ends_at, settled_at, leader_id, current_amount_cents, head_seq, head_hash from public.lots where id = $1',
    [lotId],
  );
  if (!lot) return null;
  const bids = await readBids(db, lotId);
  const last = bids.at(-1);
  const brokenAtSeq = firstBrokenSeq(config.auditHmacSecret, lotId, bids, { seq: lot.head_seq, hash: lot.head_hash });
  const copyDisagrees = last === undefined
    ? lot.leader_id !== null || lot.current_amount_cents !== null
    : lot.leader_id !== last.bidderId || lot.current_amount_cents !== last.amountCents;

  const reference = await referenceOf(db, config);

  const now = await databaseNow(db);
  let reason = '';
  if (lot.status !== 'active' || lot.settled_at !== null) reason = 'O lote não está ativo e não liquidado.';
  else if (now.getTime() < lot.ends_at.getTime()) reason = 'O lote ainda não encerrou.';
  else if (last === undefined && lot.head_seq === 0 && lot.head_hash === null && lot.leader_id === null) reason = 'Lote sem lances: a liquidação o fecha.';
  else if (brokenAtSeq === null && !copyDisagrees) reason = 'O histórico confere e a cópia confere com o último lance: não há o que liberar.';
  else if (reference === 'broken') reason = 'Nenhuma das últimas liquidações confere com o segredo em uso: o segredo ou essas liquidações foram alterados. Nada foi gravado.';
  return {
    lotId,
    status: lot.status,
    copy: { leaderId: lot.leader_id, amountCents: lot.current_amount_cents },
    last: last === undefined ? null : { seq: last.seq, leaderId: last.bidderId, amountCents: last.amountCents },
    headSeq: lot.head_seq,
    brokenAtSeq,
    copyDisagrees,
    reference,
    decidable: reason === '',
    reason,
  };
}
