-- Bids: the live state of a lot and its append-only, hash-chained bid history.
-- Money: a bid commits the bidder's balance (wallets.committed_cents); the previous leader is released
-- in the same transaction. The ledger records only deposits and, later, settlement.

alter table public.lots
  add column current_amount_cents bigint check (current_amount_cents > 0),
  add column leader_id uuid references public.profiles (id),
  add column head_seq integer not null default 0 check (head_seq >= 0),
  add column head_hash text;

create table public.bids (
  lot_id uuid not null references public.lots (id),
  seq integer not null check (seq > 0),
  bidder_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  placed_at timestamptz not null,
  prev_hash text not null check (char_length(prev_hash) = 64),
  hash text not null check (char_length(hash) = 64),
  primary key (lot_id, seq)
);

create function public.bids_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bids is append-only' using errcode = '55000';
end;
$$;

create trigger bids_no_update_delete
  before update or delete on public.bids
  for each row execute function public.bids_append_only();

create trigger bids_no_truncate
  before truncate on public.bids
  for each statement execute function public.bids_append_only();

alter table public.bids enable row level security;
revoke all on public.bids from anon, authenticated;
revoke execute on function public.bids_append_only() from public, anon, authenticated;
