import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { signUpUser, type TestUser } from '../helpers/auth';
import { startTestServer, type TestServer } from '../helpers/server';

/**
 * Real JWT verification against a real key server: a tiny HTTP server publishes the public key
 * (JWKS) and the tests sign tokens with the matching private key, so each claim rule is exercised
 * by the production code path (expiry, audience, issuer, key, algorithm, subject).
 */
let jwksServer: Server;
let issuer: string;
let privateKey: CryptoKey;
let app: TestServer;
let user: TestUser;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  jwksServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth/v1/.well-known/jwks.json') res.end(JSON.stringify({ keys: [jwk] }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${String((jwksServer.address() as AddressInfo).port)}`;
  issuer = `${base}/auth/v1`;
  app = await startTestServer({ supabaseUrl: base });
  user = await signUpUser();
});
afterAll(async () => {
  await app.close();
  jwksServer.close();
});

const token = (claims: Record<string, unknown> = {}, options: { exp?: string | number; key?: CryptoKey; alg?: string; omitSub?: boolean } = {}) => {
  const jwt = new SignJWT({ aud: 'authenticated', ...claims })
    .setProtectedHeader({ alg: options.alg ?? 'ES256', kid: 'test-key' })
    .setIssuer((claims.iss as string | undefined) ?? issuer)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '5m');
  if (!options.omitSub) jwt.setSubject(user.id);
  return jwt.sign(options.key ?? privateKey);
};
const me = async (jwt: string) => fetch(`${app.url}/api/me`, { headers: { Authorization: `Bearer ${jwt}` } });

describe('token claims', () => {
  it('accepts a correctly signed token for a real user (control)', async () => {
    const response = await me(await token());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(user.id);
  });

  it.each([
    ['expired', () => token({}, { exp: Math.floor(Date.now() / 1000) - 60 })],
    ['for another audience', () => token({ aud: 'anon' })],
    ['from another issuer', () => token({ iss: 'https://evil.example/auth/v1' })],
    ['without a subject', () => token({}, { omitSub: true })],
    ['not valid yet', () => token({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
  ])('refuses a token that is %s', async (_name, make) => {
    const response = await me(await make());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'unauthenticated', message: expect.any(String) as string });
  });

  it('refuses a token signed by a different key, even with the right key id', async () => {
    const other = await generateKeyPair('ES256');
    expect((await me(await token({}, { key: other.privateKey }))).status).toBe(401);
  });

  it('refuses a token that uses an algorithm outside the allowed list', async () => {
    const forged = await new SignJWT({ aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setSubject(user.id)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('any-shared-secret-of-at-least-32-bytes!!'));
    expect((await me(forged)).status).toBe(401);
  });
});

async function withKeyServer(respond: (res: import('node:http').ServerResponse) => void, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((_req, res) => { respond(res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  } finally {
    server.close();
  }
}

describe('the key server is a dependency: its failure is our error, not the caller\'s', () => {
  // The server logs the cause of each failure on purpose: capture it, and assert it, instead of printing it on every run.
  let logged: MockInstance<typeof console.error>;
  beforeEach(() => { logged = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { logged.mockRestore(); });

  it('answers 500 internal_error, never 401, when the key server is unreachable', async () => {
    const broken = await startTestServer({ supabaseUrl: 'http://127.0.0.1:1' });
    try {
      const response = await fetch(`${broken.url}/api/me`, { headers: { Authorization: `Bearer ${await token()}` } });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: 'internal_error', message: expect.any(String) as string });
      expect(logged).toHaveBeenCalledWith('unhandled error:', expect.any(String));
    } finally {
      await broken.close();
    }
  });

  it.each([
    ['answers 503', (res: import('node:http').ServerResponse) => { res.statusCode = 503; res.end('unavailable'); }],
    ['answers 200 with a body that is not JSON', (res: import('node:http').ServerResponse) => { res.end('<html>not keys</html>'); }],
    ['answers JSON that is not a key set', (res: import('node:http').ServerResponse) => { res.setHeader('Content-Type', 'application/json'); res.end('{"hello":"world"}'); }],
  ])('answers 500, never 401, when the key server %s', async (_name, respond) => {
    await withKeyServer(respond, async (url) => {
      const broken = await startTestServer({ supabaseUrl: url });
      try {
        const response = await fetch(`${broken.url}/api/me`, { headers: { Authorization: `Bearer ${await token()}` } });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ code: 'internal_error', message: expect.any(String) as string });
        expect(logged).toHaveBeenCalledWith('unhandled error:', expect.any(String));
      } finally {
        await broken.close();
      }
    });
  });
});
