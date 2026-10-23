-- Scheduler (pg_cron) and outbound HTTP (pg_net) for the per-minute close-due call.
-- The job itself holds a secret, so it is created by supabase/ops/schedule-close-due.sql, not here.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
