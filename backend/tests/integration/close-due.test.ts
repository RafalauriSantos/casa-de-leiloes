import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

const call = (authorization?: string) =>
  fetch(`${server.url}/api/internal/close-due`, {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  });

describe('POST /api/internal/close-due', () => {
  it('rejects a call without the cron secret', async () => {
    expect((await call()).status).toBe(401);
  });

  it('rejects a wrong cron secret', async () => {
    expect((await call('Bearer wrong-secret-value')).status).toBe(401);
  });

  it('accepts the cron secret', async () => {
    const response = await call(`Bearer ${testConfig().cronSecret}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settled: 0 });
  });
});
