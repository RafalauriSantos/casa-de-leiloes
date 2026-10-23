import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  AUDIT_HMAC_SECRET: 'a'.repeat(32),
  CRON_SECRET: 'b'.repeat(16),
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const config = loadConfig(valid);
    expect(config.supabaseUrl).toBe('http://127.0.0.1:54321');
    expect(config.cronSecret).toBe('b'.repeat(16));
  });

  it.each(['DATABASE_URL', 'SUPABASE_URL', 'AUDIT_HMAC_SECRET', 'CRON_SECRET'])(
    'fails when %s is missing (no default secrets)',
    (key) => {
      const env = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
      expect(() => loadConfig(env)).toThrow(key);
    },
  );

  it('rejects a short HMAC secret without echoing it', () => {
    const env = { ...valid, AUDIT_HMAC_SECRET: 'too-short' };
    expect(() => loadConfig(env)).toThrow('AUDIT_HMAC_SECRET');
    expect(() => loadConfig(env)).not.toThrow(/too-short/);
  });
});
