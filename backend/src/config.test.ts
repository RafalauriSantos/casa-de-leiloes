import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  AUDIT_HMAC_SECRET: 'a'.repeat(32),
  CRON_SECRET: 'b'.repeat(16),
  ANCHOR_MODE: 'off',
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const config = loadConfig(valid);
    expect(config.supabaseUrl).toBe('http://127.0.0.1:54321');
    expect(config.cronSecret).toBe('b'.repeat(16));
  });

  it('drops trailing slashes from SUPABASE_URL, so the token issuer is built correctly', () => {
    expect(loadConfig({ ...valid, SUPABASE_URL: 'https://x.supabase.co//' }).supabaseUrl).toBe('https://x.supabase.co');
  });

  it.each(['DATABASE_URL', 'SUPABASE_URL', 'AUDIT_HMAC_SECRET', 'CRON_SECRET', 'ANCHOR_MODE'])(
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

  describe('the public anchor', () => {
    const github = { ...valid, ANCHOR_MODE: 'github', ANCHOR_GITHUB_REPO: 'owner/anchor', ANCHOR_GITHUB_TOKEN: 'token-value-for-the-test' };

    it('is off when the mode says so, even if the other settings are present', () => {
      expect(loadConfig({ ...github, ANCHOR_MODE: 'off' }).anchor).toEqual({ mode: 'off' });
    });

    it('reads the repository, the token and the defaults when the mode is github', () => {
      expect(loadConfig(github).anchor).toEqual({
        mode: 'github',
        repo: 'owner/anchor',
        token: 'token-value-for-the-test',
        apiUrl: 'https://api.github.com',
        branch: 'main',
      });
    });

    it('drops trailing slashes from the API address', () => {
      const config = loadConfig({ ...github, ANCHOR_GITHUB_API_URL: 'http://127.0.0.1:9999//', ANCHOR_GITHUB_BRANCH: 'anchor' });
      expect(config.anchor).toMatchObject({ apiUrl: 'http://127.0.0.1:9999', branch: 'anchor' });
    });

    it.each(['ANCHOR_GITHUB_REPO', 'ANCHOR_GITHUB_TOKEN'])('fails when the mode is github and %s is missing', (key) => {
      const env = Object.fromEntries(Object.entries(github).filter(([name]) => name !== key));
      expect(() => loadConfig(env)).toThrow(key);
    });

    it('rejects an unknown mode, and a repository that is not owner/name, without echoing the token', () => {
      expect(() => loadConfig({ ...github, ANCHOR_MODE: 'maybe' })).toThrow('ANCHOR_MODE');
      expect(() => loadConfig({ ...github, ANCHOR_GITHUB_REPO: 'not-a-repo' })).toThrow('ANCHOR_GITHUB_REPO');
      expect(() => loadConfig({ ...github, ANCHOR_GITHUB_REPO: 'not-a-repo' })).not.toThrow(/token-value-for-the-test/);
    });

    it('treats blank anchor settings as not set, as in a copied .env.example', () => {
      expect(loadConfig({ ...valid, ANCHOR_GITHUB_REPO: '', ANCHOR_GITHUB_TOKEN: '', ANCHOR_GITHUB_API_URL: '', ANCHOR_GITHUB_BRANCH: '' }).anchor).toEqual({ mode: 'off' });
      expect(() => loadConfig({ ...github, ANCHOR_GITHUB_TOKEN: '' })).toThrow('ANCHOR_GITHUB_TOKEN');
    });

    it('refuses an API address that would send the token unencrypted, except on this machine', () => {
      expect(() => loadConfig({ ...github, ANCHOR_GITHUB_API_URL: 'http://api.example.com' })).toThrow('ANCHOR_GITHUB_API_URL');
      expect(loadConfig({ ...github, ANCHOR_GITHUB_API_URL: 'http://localhost:9999' }).anchor).toMatchObject({ apiUrl: 'http://localhost:9999' });
      expect(loadConfig({ ...github, ANCHOR_GITHUB_API_URL: 'https://ghe.example.com/api/v3' }).anchor).toMatchObject({ apiUrl: 'https://ghe.example.com/api/v3' });
    });

    it('drops spaces and a newline around the token and the repository', () => {
      const config = loadConfig({ ...github, ANCHOR_GITHUB_TOKEN: '  secret-token\n', ANCHOR_GITHUB_REPO: ' owner/anchor ' });
      expect(config.anchor).toMatchObject({ token: 'secret-token', repo: 'owner/anchor' });
    });

    it('accepts http on the local machine, in either address form', () => {
      expect(loadConfig({ ...github, ANCHOR_GITHUB_API_URL: 'http://[::1]:9999' }).anchor).toMatchObject({ apiUrl: 'http://[::1]:9999' });
    });

    it.each(['../x', 'owner/..', './repo', 'owner/'])('rejects the repository %s', (repo) => {
      expect(() => loadConfig({ ...github, ANCHOR_GITHUB_REPO: repo })).toThrow('ANCHOR_GITHUB_REPO');
    });
  });
});
