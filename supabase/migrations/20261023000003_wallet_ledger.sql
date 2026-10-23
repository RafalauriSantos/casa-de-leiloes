-- Append-only record of money movements. Deposits carry the client's idempotency key, so a retried
-- or double-clicked deposit credits once. Settlement kinds (slice 4) are unique per lot.
create table public.wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('deposit', 'lot_debit', 'lot_credit')),
  amount_cents bigint not null check (amount_cents <> 0),
  lot_id uuid,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_deposit_is_positive check (kind <> 'deposit' or amount_cents > 0),
  constraint wallet_ledger_deposit_has_key check (kind <> 'deposit' or idempotency_key is not null)
);

create unique index wallet_ledger_idempotency_key
  on public.wallet_ledger (user_id, idempotency_key) where idempotency_key is not null;
create unique index wallet_ledger_settlement_once
  on public.wallet_ledger (lot_id, kind) where kind in ('lot_debit', 'lot_credit');

alter table public.wallet_ledger enable row level security;
revoke all on public.wallet_ledger from anon, authenticated;
