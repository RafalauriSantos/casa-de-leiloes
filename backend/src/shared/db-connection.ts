import type pg from 'pg';
import { SUPABASE_CA } from './supabase-ca';

/**
 * Builds the pool settings from DATABASE_URL. A URL with `sslmode` (the hosted Supabase pooler)
 * is verified against the Supabase CA; a local URL stays plain. `sslmode` is removed from the URL
 * because the driver would otherwise let it override the explicit TLS settings.
 */
export function toPoolConfig(databaseUrl: string): Pick<pg.PoolConfig, 'connectionString' | 'ssl'> {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('sslmode')) return { connectionString: databaseUrl };
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: { ca: SUPABASE_CA, rejectUnauthorized: true } };
}
