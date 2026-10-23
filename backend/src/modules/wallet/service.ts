import type { WalletResponse } from '@casa/contracts';
import type { Db, Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { availableCents, checkDeposit } from './rules';

interface WalletRow {
  total_cents: number;
  committed_cents: number;
}

function toResponse(row: WalletRow): WalletResponse {
  const wallet = { totalCents: row.total_cents, committedCents: row.committed_cents };
  return { ...wallet, availableCents: availableCents(wallet) };
}

export async function getWallet(db: Queryable, userId: string): Promise<WalletResponse> {
  const [row] = await db.query<WalletRow>('select total_cents, committed_cents from public.wallets where user_id = $1', [userId]);
  if (!row) throw new AppError('not_found', 'Carteira não encontrada.');
  return toResponse(row);
}

/**
 * Credits a deposit exactly once per Idempotency-Key. The ledger insert and the balance update share
 * one transaction; a concurrent retry with the same key waits on the unique index, then replays.
 */
export async function deposit(db: Db, userId: string, amountCents: number, key: string): Promise<{ wallet: WalletResponse; replayed: boolean }> {
  const refusal = checkDeposit(amountCents);
  if (refusal) throw new AppError('validation_error', refusal);

  return db.tx(async (tx) => {
    const inserted = await tx.query<{ id: number }>(
      `insert into public.wallet_ledger (user_id, kind, amount_cents, idempotency_key)
       values ($1, 'deposit', $2, $3)
       on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
       returning id`,
      [userId, amountCents, key],
    );

    if (inserted.length === 0) {
      const [previous] = await tx.query<{ amount_cents: number }>('select amount_cents from public.wallet_ledger where user_id = $1 and idempotency_key = $2', [userId, key]);
      if (previous?.amount_cents !== amountCents) {
        throw new AppError('idempotency_conflict', 'Esta chave de requisição já foi usada com outro valor.');
      }
      return { wallet: await getWallet(tx, userId), replayed: true };
    }

    // Atomic increment: concurrent deposits add up instead of overwriting each other.
    const [row] = await tx.query<WalletRow>(
      'update public.wallets set total_cents = total_cents + $2 where user_id = $1 returning total_cents, committed_cents',
      [userId, amountCents],
    );
    if (!row) throw new AppError('not_found', 'Carteira não encontrada.');
    return { wallet: toResponse(row), replayed: false };
  });
}
