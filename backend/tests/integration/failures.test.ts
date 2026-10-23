import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/create-app';
import { createDb, type Db } from '../../src/shared/db';
import { signUpUser } from '../helpers/auth';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

describe('a dependency failure is an error, never a fake success', () => {
  let brokenUrl: string;
  let brokenDb: Db;
  let brokenServer: ReturnType<typeof serve>;

  beforeAll(async () => {
    // A real app whose database is a closed port: the failure is real, not simulated.
    brokenDb = createDb('postgresql://postgres:secret-password@127.0.0.1:1/postgres');
    const app = createApp({ config: testConfig(), db: brokenDb });
    brokenServer = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0 }, () => { resolve(s); });
    });
    brokenUrl = `http://127.0.0.1:${String((brokenServer.address() as AddressInfo).port)}`;
  });
  afterAll(async () => {
    brokenServer.close();
    await brokenDb.end();
  });

  it('answers /api/health with 500 internal_error and leaks nothing about the database', async () => {
    const response = await fetch(`${brokenUrl}/api/health`);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ code: 'internal_error', message: 'Erro interno. Tente novamente.' });
    expect(text).not.toMatch(/secret-password|127\.0\.0\.1|ECONNREFUSED/);
  });
});

describe('a user without a wallet (data inconsistency)', () => {
  it('reads as not_found', async () => {
    const user = await signUpUser();
    await server.db.query('delete from public.wallets where user_id = $1', [user.id]);
    const response = await fetch(`${server.url}/api/wallet`, { headers: { Authorization: `Bearer ${user.token}` } });
    expect(response.status).toBe(404);
  });

  it('refuses a deposit and rolls the ledger entry back (all or nothing)', async () => {
    const user = await signUpUser();
    await server.db.query('delete from public.wallets where user_id = $1', [user.id]);
    const response = await fetch(`${server.url}/api/wallet/deposits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ amountCents: 5_000 }),
    });
    expect(response.status).toBe(404);
    const rows = await server.db.query('select 1 from public.wallet_ledger where user_id = $1', [user.id]);
    expect(rows).toHaveLength(0);
  });
});
