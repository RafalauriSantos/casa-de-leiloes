-- D20: the owner can release the money committed on a lot whose history fails verification. The lot gets its own
-- status, and each decision is one append-only row: who decided, why, and the first broken sequence number.

alter table public.lots drop constraint if exists lots_status_check;
alter table public.lots
  add constraint lots_status_check check (status in ('active', 'cancelled', 'integrity_cancelled'));

create table public.integrity_decisions (
  id bigint generated always as identity primary key,
  lot_id uuid not null references public.lots (id),
  decided_by text not null check (char_length(decided_by) between 1 and 80),
  reason text not null check (char_length(reason) between 1 and 500),
  -- 0 when the chain verifies and only the lot's copy disagreed with its last bid.
  broken_seq integer not null check (broken_seq >= 0),
  -- Who was freed and how much: the audit trail says it, not only that a decision was made.
  leader_id uuid references public.profiles (id),
  released_cents bigint not null check (released_cents >= 0),
  decided_at timestamptz not null default now(),
  -- One decision per lot: a second release of the same money is impossible by construction.
  constraint integrity_decisions_one_per_lot unique (lot_id)
);

alter table public.integrity_decisions enable row level security;
revoke all on public.integrity_decisions from anon, authenticated;

-- Append-only, like the wallet ledger: update, delete and truncate are refused for every normal connection.
create function public.integrity_decisions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'integrity_decisions is append-only' using errcode = '55000';
end;
$$;

revoke execute on function public.integrity_decisions_append_only() from public, anon, authenticated;

create trigger integrity_decisions_no_update_delete
  before update or delete on public.integrity_decisions
  for each row execute function public.integrity_decisions_append_only();

create trigger integrity_decisions_no_truncate
  before truncate on public.integrity_decisions
  for each statement execute function public.integrity_decisions_append_only();
