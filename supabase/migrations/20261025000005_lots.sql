-- Lots: an auction an auctioneer publishes from an item of the external catalog.
-- The item is copied here at creation (title, image URL, attributes): nothing reads the catalog afterwards.
-- The live and scheduled and ended states are not stored: they are derived from the clock.
create table public.lots (
  id uuid primary key default gen_random_uuid(),
  auctioneer_id uuid not null references public.profiles (id),
  external_id text not null check (external_id ~ '^[0-9]{1,12}$'),
  title text not null check (char_length(title) between 3 and 120),
  item_image_url text not null,
  item_source_url text not null,
  item_attributes jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  starting_bid_cents bigint not null check (starting_bid_cents > 0),
  increment_cents bigint not null check (increment_cents > 0),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  -- Maintained by the bidding slice; edit and cancel are refused while it is above zero.
  bid_count integer not null default 0 check (bid_count >= 0),
  created_at timestamptz not null default now(),
  constraint lots_end_after_start check (ends_at > starts_at)
);

create index lots_by_end on public.lots (ends_at) where status = 'active';
create index lots_by_auctioneer on public.lots (auctioneer_id, created_at desc);

alter table public.lots enable row level security;
revoke all on public.lots from anon, authenticated;
