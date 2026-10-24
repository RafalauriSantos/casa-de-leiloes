-- Settlement (slice 4): a lot closes once. The winner pays the winning amount to the auctioneer, the
-- money moves only through wallet_ledger rows of kind lot_debit and lot_credit, and a receipt is written.
-- Outbid bidders were released when they lost the lead, so only the winner's commitment is cleared here.

alter table public.lots
  add column settled_at timestamptz,
  add column outcome text check (outcome in ('sold', 'no_bids')),
  add constraint lots_settled_together check ((settled_at is null) = (outcome is null));

alter table public.wallet_ledger
  add constraint wallet_ledger_lot_debit_is_negative check (kind <> 'lot_debit' or amount_cents < 0),
  add constraint wallet_ledger_lot_credit_is_positive check (kind <> 'lot_credit' or amount_cents > 0),
  add constraint wallet_ledger_lot_kind_has_lot check (kind not in ('lot_debit', 'lot_credit') or lot_id is not null);

-- The receipt shows the pseudonym only; the winner's id stays in the database.
create table public.receipts (
  code text primary key check (code ~ '^[0-9a-f]{32}$'),
  lot_id uuid not null unique references public.lots (id),
  winner_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  head_seq integer not null check (head_seq > 0),
  head_hash text not null check (char_length(head_hash) = 64),
  closed_at timestamptz not null
);

alter table public.receipts enable row level security;
revoke all on public.receipts from anon, authenticated;
