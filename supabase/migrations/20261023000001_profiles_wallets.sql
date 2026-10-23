-- Identity and money base: profiles, wallets and the sign-up trigger.
-- RLS is on with no policies: Supabase's REST layer exposes nothing, only our API reads the database.

create type public.user_role as enum ('auctioneer', 'bidder');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'bidder',
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  total_cents bigint not null default 0 check (total_cents >= 0),
  committed_cents bigint not null default 0 check (committed_cents >= 0),
  constraint wallets_committed_within_total check (total_cents >= committed_cents)
);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;

revoke all on public.profiles, public.wallets from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Every sign-up becomes a bidder. The role is never read from user-editable metadata:
-- auctioneers are created by the seed, which sets the role explicitly.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    'bidder',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  insert into public.wallets (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
