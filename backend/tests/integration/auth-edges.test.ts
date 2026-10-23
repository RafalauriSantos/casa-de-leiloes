import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signUpUser } from '../helpers/auth';
import { startTestServer, type TestServer } from '../helpers/server';
import { requireEnv } from '../helpers/test-config';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

const get = (path: string, authorization?: string) =>
  fetch(`${server.url}${path}`, { headers: authorization ? { Authorization: authorization } : {} });

describe('token edge cases (every protected route answers 401 or 403, never 200)', () => {
  const routes = ['/api/me', '/api/wallet'];

  it.each(routes)('%s refuses a Supabase anon key used as a bearer token', async (path) => {
    expect((await get(path, `Bearer ${requireEnv('SUPABASE_ANON_KEY')}`)).status).toBe(401);
  });

  it.each(routes)('%s refuses other authorization schemes and an empty bearer', async (path) => {
    const user = await signUpUser();
    expect((await get(path, `Basic ${user.token}`)).status).toBe(401);
    expect((await get(path, 'Bearer ')).status).toBe(401);
    expect((await get(path, user.token)).status).toBe(401);
  });

  it.each(routes)('%s refuses a token with a stripped signature', async (path) => {
    const user = await signUpUser();
    const [header, payload] = user.token.split('.');
    expect((await get(path, `Bearer ${header ?? ''}.${payload ?? ''}.`)).status).toBe(401);
  });

  it('refuses a valid token whose user has no profile (403, not a crash)', async () => {
    const user = await signUpUser();
    await server.db.query('delete from public.profiles where id = $1', [user.id]);
    const response = await get('/api/me', `Bearer ${user.token}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'forbidden', message: expect.any(String) as string });
  });

  it('takes the display name from sign-up metadata, falling back to the e-mail name', async () => {
    const named = await signUpUser({ displayName: '  Maria Souza  ' });
    const unnamed = await signUpUser();
    const read = async (token: string) => ((await (await get('/api/me', `Bearer ${token}`)).json()) as { displayName: string }).displayName;
    expect(await read(named.token)).toBe('Maria Souza');
    expect(await read(unnamed.token)).toBe(unnamed.email.split('@')[0]);
  });
});
