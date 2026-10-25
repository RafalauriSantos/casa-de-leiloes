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
    const body = (await response.json()) as { settled: number; failed: number; anchor: { mode: string; stale: number; failed: number } };
    expect(Object.keys(body).sort()).toEqual(['anchor', 'failed', 'settled']);
    expect(body.settled).toBeGreaterThanOrEqual(0);
    // Other test files may leave a lot that cannot be settled, so the status follows the count.
    expect(body.anchor.mode).toBe('off');
    expect(response.status).toBe(body.failed > 0 ? 500 : 200);
  });
});
