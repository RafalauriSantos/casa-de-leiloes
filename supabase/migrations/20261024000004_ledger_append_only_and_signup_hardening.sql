-- The ledger is an append-only record of money movements: update, delete and truncate are refused by
-- a trigger for every normal connection (the API roles and our own backend). The table owner could
-- still disable the trigger on purpose; that is a deliberate act, not an accident.
create function public.wallet_ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'wallet_ledger is append-only' using errcode = '55000';
end;
$$;

create trigger wallet_ledger_no_update_delete
  before update or delete on public.wallet_ledger
  for each row execute function public.wallet_ledger_append_only();

create trigger wallet_ledger_no_truncate
  before truncate on public.wallet_ledger
  for each statement execute function public.wallet_ledger_append_only();

-- The display name comes from user-editable sign-up metadata: cap it instead of failing the sign-up.
create or replace function public.handle_new_user()
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
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 80)
  );
  insert into public.wallets (user_id) values (new.id);
  return new;
end;
$$;

-- Trigger functions are never meant to be called through the API roles.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.wallet_ledger_append_only() from public, anon, authenticated;
