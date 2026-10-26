-- B14 (D24): the sign-up asks "Quero comprar" (bidder) or "Quero vender" (auctioneer). The choice travels in the
-- sign-up metadata, which the user can edit later, so it is read here only, once, when the account is created.
-- From then on the role comes from public.profiles, which the API roles cannot write. Any other value is a bidder.
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
    case when new.raw_user_meta_data ->> 'role' = 'auctioneer' then 'auctioneer'::public.user_role else 'bidder'::public.user_role end,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 80)
  );
  -- Every account has a wallet: a bidder deposits into it, and the settlement credits an auctioneer's.
  insert into public.wallets (user_id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
