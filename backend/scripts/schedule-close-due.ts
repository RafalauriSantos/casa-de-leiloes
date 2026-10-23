/**
 * Schedules the per-minute call to POST /api/internal/close-due with pg_cron + pg_net.
 * The app URL and the cron secret go to Supabase Vault (never into SQL files or migrations).
 *
 *   DATABASE_URL=... CRON_SECRET=... APP_URL=https://<domain> npx tsx backend/scripts/schedule-close-due.ts
 */
import { readFile } from 'node:fs/promises';
import { createDb } from '../src/shared/db';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const db = createDb(required('DATABASE_URL'));
const secrets = { app_url: required('APP_URL'), cron_secret: required('CRON_SECRET') };
const schedule = await readFile(new URL('../../supabase/ops/schedule-close-due.sql', import.meta.url), 'utf8');

try {
  await db.tx(async (tx) => {
    for (const [name, value] of Object.entries(secrets)) {
      const [existing] = await tx.query<{ id: string }>('select id from vault.secrets where name = $1', [name]);
      if (existing) await tx.query('select vault.update_secret($1, $2)', [existing.id, value]);
      else await tx.query('select vault.create_secret($1, $2)', [value, name]);
    }
    await tx.query(schedule);
  });
  const jobs = await db.query<{ jobname: string; schedule: string; active: boolean }>(
    "select jobname, schedule, active from cron.job where jobname = 'close-due'",
  );
  console.log('scheduled:', JSON.stringify(jobs));
} finally {
  await db.end();
}
