import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnchorError, readAnchorFile, writeAnchorFile, type GithubTarget } from '../../src/modules/anchor/github-client';
import { recorded, startGithubStub, type GithubStub } from '../helpers/github-stub';

// The GitHub client against real answers recorded from the anchor repository (see helpers/github-stub.ts).
// Written by hand, not recorded: the 503, the rate limits (403 with no calls left, 403 with Retry-After, 429), the 403 too_large,
// the 200 with `encoding: none` and the 301.

const TOKEN = 'test-token-that-must-never-appear-in-an-error';
let stub: GithubStub;
let target: GithubTarget;

beforeAll(async () => {
  stub = await startGithubStub();
  target = { repo: 'owner/anchor', token: TOKEN, apiUrl: stub.baseUrl, branch: 'main' };
});
afterAll(async () => {
  await stub.close();
});
beforeEach(() => {
  stub.reset();
});

const FILE = 'lots/a.csv';

const b64 = (text: string) => Buffer.from(text).toString('base64');

async function failureOf(run: Promise<unknown>): Promise<AnchorError> {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AnchorError)) throw new Error('expected an AnchorError');
  return error;
}

describe('readAnchorFile', () => {
  it('returns nothing for a file that does not exist yet', async () => {
    stub.script(FILE, [await recorded('get-missing')]);
    expect(await readAnchorFile(target, 'lots/a.csv')).toBeNull();
    expect(stub.requestsFor(FILE)[0]).toMatchObject({ method: 'GET', path: '/repos/owner/anchor/contents/lots/a.csv?ref=main' });
  });

  it('asks as the token, for the right API version, and decodes the content and the sha', async () => {
    stub.script(FILE, [await recorded('get-ok', { content: b64('first line\nsecond line\n'), sha: 'abc123' })]);
    expect(await readAnchorFile(target, 'lots/a.csv')).toEqual({ sha: 'abc123', content: 'first line\nsecond line\n' });
    const headers = stub.requestsFor(FILE)[0]?.headers;
    expect(headers?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers?.accept).toBe('application/vnd.github+json');
    expect(headers?.['x-github-api-version']).toBe('2022-11-28');
    expect(headers?.['user-agent']).toBeTruthy();
  });

  it('decodes content that GitHub breaks into lines of base64', async () => {
    const text = 'x'.repeat(200);
    const wrapped = b64(text).replace(/(.{60})/g, '$1\n');
    stub.script(FILE, [await recorded('get-ok', { content: wrapped, sha: 'abc123' })]);
    expect((await readAnchorFile(target, 'lots/a.csv'))?.content).toBe(text);
  });
});

describe('writeAnchorFile', () => {
  it('creates a file: the content in base64, the branch and the message, and no sha', async () => {
    stub.script(FILE, [await recorded('put-create')]);
    await writeAnchorFile(target, 'lots/a.csv', 'hello\n', undefined, 'anchor a');
    expect(stub.requestsFor(FILE)[0]).toMatchObject({ method: 'PUT', path: '/repos/owner/anchor/contents/lots/a.csv' });
    expect(stub.requestsFor(FILE)[0]?.body).toEqual({ message: 'anchor a', content: b64('hello\n'), branch: 'main' });
  });

  it('updates a file by sending the sha it read', async () => {
    stub.script(FILE, [await recorded('put-update-ok')]);
    await writeAnchorFile(target, 'lots/a.csv', 'hello\nmore\n', 'abc123', 'anchor a');
    expect(stub.requestsFor(FILE)[0]?.body).toEqual({ message: 'anchor a', content: b64('hello\nmore\n'), branch: 'main', sha: 'abc123' });
  });
});

describe('failures are named, and never carry the token', () => {
  const cases: [string, string, AnchorError['kind']][] = [
    ['put-update-wrong-sha', 'a sha that no longer matches (409)', 'conflict'],
    ['put-create-existing-no-sha', 'a file that already exists, written without sha (422)', 'conflict'],
    ['put-bad-token', 'a refused token (401)', 'auth'],
  ];
  it.each(cases)('write: %s is %s', async (fixture, _what, kind) => {
    stub.script(FILE, [await recorded(fixture)]);
    const error = await failureOf(writeAnchorFile(target, 'lots/a.csv', 'x\n', undefined, 'm'));
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain(TOKEN);
  });

  it('read: a refused token (401) is auth', async () => {
    stub.script(FILE, [await recorded('get-bad-token')]);
    const error = await failureOf(readAnchorFile(target, 'lots/a.csv'));
    expect(error.kind).toBe('auth');
    expect(error.message).not.toContain(TOKEN);
  });

  it('a server error (503, written by hand) is unavailable', async () => {
    stub.script(FILE, [{ status: 503, headers: { 'content-type': 'application/json' }, body: { message: 'Service Unavailable' } }]);
    expect((await failureOf(readAnchorFile(target, 'lots/a.csv'))).kind).toBe('unavailable');
  });

  it('a rate limit (403 with no calls left, written by hand) is rate_limit, and so is a 429', async () => {
    stub.script(FILE, [
      { status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded' } },
      { status: 429, headers: { 'content-type': 'application/json' }, body: { message: 'Too many requests' } },
    ]);
    expect((await failureOf(readAnchorFile(target, 'lots/a.csv'))).kind).toBe('rate_limit');
    expect((await failureOf(readAnchorFile(target, 'lots/a.csv'))).kind).toBe('rate_limit');
  });

  it('a 403 that is not a rate limit is auth', async () => {
    stub.script(FILE, [{ status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000' }, body: { message: 'Resource not accessible' } }]);
    expect((await failureOf(readAnchorFile(target, 'lots/a.csv'))).kind).toBe('auth');
  });

  it('a write to a repository, a branch or a path GitHub does not find (404) is auth: the token or the target is wrong', async () => {
    stub.script(FILE, [await recorded('get-missing')]);
    expect((await failureOf(writeAnchorFile(target, FILE, 'x\n', undefined, 'm'))).kind).toBe('auth');
  });

  it('a 403 that names a file too large to read (written from memory, not recorded) is too_large, not a refused token', async () => {
    stub.script(FILE, [{ status: 403, headers: { 'content-type': 'application/json' }, body: { message: 'This API returns blobs up to 1 MB in size.', errors: [{ code: 'too_large' }] } }]);
    expect((await failureOf(readAnchorFile(target, FILE))).kind).toBe('too_large');
  });

  it('a body that is not what GitHub documents is unavailable, not a fake success', async () => {
    stub.script(FILE, [{ status: 200, headers: { 'content-type': 'application/json' }, body: { unexpected: true } }]);
    expect((await failureOf(readAnchorFile(target, 'lots/a.csv'))).kind).toBe('unavailable');
  });

  it('a file over 1 MB, which GitHub answers with no content, is unavailable: it is never read as empty', async () => {
    stub.script(FILE, [await recorded('get-ok', { content: '', encoding: 'none' })]);
    expect((await failureOf(readAnchorFile(target, FILE))).kind).toBe('unavailable');
  });

  it('a 403 that asks to wait (Retry-After) is rate_limit', async () => {
    stub.script(FILE, [{ status: 403, headers: { 'content-type': 'application/json', 'retry-after': '60' }, body: { message: 'secondary rate limit' } }]);
    expect((await failureOf(readAnchorFile(target, FILE))).kind).toBe('rate_limit');
  });

  it('a call that takes longer than its time limit is unavailable', async () => {
    stub.script(FILE, [{ ...(await recorded('get-missing')), delayMs: 400 }]);
    expect((await failureOf(readAnchorFile({ ...target, timeoutMs: 100 }, FILE))).kind).toBe('unavailable');
  });

  it('a redirect is not followed: the token is never sent to another address', async () => {
    stub.script(FILE, [{ status: 301, headers: { location: `${stub.baseUrl}/repos/owner/anchor/contents/lots/elsewhere.csv` }, body: '' }]);
    stub.script('lots/elsewhere.csv', [await recorded('get-missing')]);
    expect((await failureOf(readAnchorFile(target, FILE))).kind).toBe('unavailable');
    expect(stub.requestsFor(FILE)).toHaveLength(1);
    expect(stub.requestsFor('lots/elsewhere.csv')).toEqual([]);
  });

  it('an unreachable GitHub is unavailable', async () => {
    const down = { ...target, apiUrl: 'http://127.0.0.1:1' };
    const error = await failureOf(readAnchorFile(down, 'lots/a.csv'));
    expect(error.kind).toBe('unavailable');
    expect(error.message).not.toContain(TOKEN);
  });
});
