import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

describe('GET /api/health', () => {
  it('reports ok after reaching the real database', async () => {
    const response = await fetch(`${server.url}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('answers unknown routes with the single error shape', async () => {
    const response = await fetch(`${server.url}/api/does-not-exist`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'not_found', message: expect.any(String) as string });
  });
});
