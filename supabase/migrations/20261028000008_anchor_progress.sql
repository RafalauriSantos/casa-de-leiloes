-- Progress of the public anchor (D21): how far each lot's bid hashes are published, how many attempts
-- failed since, and when to try again. A bid hash is pending while head_seq is above anchored_seq.

alter table public.lots
  add column anchored_seq integer not null default 0 check (anchored_seq >= 0),
  add column anchor_attempts integer not null default 0 check (anchor_attempts >= 0),
  add column anchor_retry_at timestamptz,
  add constraint lots_anchored_within_head check (anchored_seq <= head_seq);
