// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiRequestError, apiFetch } from './api-client';

// A real HTTP server speaking the API's contract: no fetch mocking.
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/ok') {
      res.end(JSON.stringify({ hello: 'world', auth: req.headers.authorization ?? null }));
    } else if (req.url === '/refused') {
      res.statusCode = 409;
      res.end(JSON.stringify({ code: 'insufficient_funds', message: 'Saldo insuficiente.' }));
    } else {
      res.statusCode = 502;
      res.end('<html>bad gateway</html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => {
  server.close();
});

describe('apiFetch', () => {
  it('returns the body and sends the bearer token', async () => {
    expect(await apiFetch('/ok', { baseUrl, token: 'abc' })).toEqual({ hello: 'world', auth: 'Bearer abc' });
  });

  it("throws the API's code and message for a refusal", async () => {
    const error = await apiFetch('/refused', { baseUrl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'insufficient_funds', message: 'Saldo insuficiente.', status: 409 });
  });

  it('turns a non-JSON failure into a generic internal_error', async () => {
    const error = await apiFetch('/anything', { baseUrl }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'internal_error', status: 502 });
  });

  it('reports a network failure without pretending success', async () => {
    const error = await apiFetch('/ok', { baseUrl: 'http://127.0.0.1:1' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'internal_error', status: 0 });
  });
});
