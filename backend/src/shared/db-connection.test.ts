import { describe, expect, it } from 'vitest';
import { SUPABASE_CA } from './supabase-ca';
import { toPoolConfig } from './db-connection';

describe('toPoolConfig', () => {
  it('leaves a local connection without TLS', () => {
    const config = toPoolConfig('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    expect(config.ssl).toBeUndefined();
    expect(config.connectionString).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  });

  it('verifies the server against the Supabase CA when sslmode is set', () => {
    const config = toPoolConfig('postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require');
    expect(config.ssl).toEqual({ ca: SUPABASE_CA, rejectUnauthorized: true });
    // sslmode is removed so the driver cannot override the explicit TLS settings
    expect(config.connectionString).toBe('postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres');
  });

  it('keeps other query parameters', () => {
    const config = toPoolConfig('postgresql://u:p@h:6543/postgres?sslmode=require&application_name=casa');
    expect(config.connectionString).toBe('postgresql://u:p@h:6543/postgres?application_name=casa');
  });
});
