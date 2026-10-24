import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * Stands in for the GitHub Contents API on a local port. It answers with real responses recorded from
 * a scratch repository, with the identifiers replaced (tests/fixtures/github), one queue per file path, and records what it was asked.
 * Real answers hold facts of one moment (a file's content, its sha), so a test may override fields of
 * the recorded body; the status and the shape stay the ones GitHub really sent. The production client
 * runs unchanged against it. The live check against the real repository is a separate, scheduled test.
 *
 * With `fallback`, a file nobody scripted gets the recorded answer for a file that does not exist yet
 * (GET) and for a file created (PUT). The database of the tests is shared by test files that run in
 * parallel, so a publisher run can meet lots of other tests; they must not use up the scripted answers.
 */
const FIXTURES = fileURLToPath(new URL('../fixtures/github', import.meta.url));
const CONTENTS = '/contents/';

export interface StubAnswer {
  /** Holds the answer back, to make GitHub slow. */
  delayMs?: number;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface RecordedRequest {
  method: string;
  /** The file path inside the repository, for example lots/abc.csv. */
  file: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown> | undefined;
}

export interface GithubStub {
  baseUrl: string;
  requests: RecordedRequest[];
  /** The requests that were about this file, in order. */
  requestsFor: (file: string) => RecordedRequest[];
  /** Replaces the queue of answers of one file: one answer per request, in order. */
  script: (file: string, answers: StubAnswer[]) => void;
  /** Forgets the queues and the recorded requests. */
  reset: () => void;
  close: () => Promise<void>;
}

/** A recorded answer, with fields of its body replaced when the test needs its own values. */
export async function recorded(name: string, overrides: Record<string, unknown> = {}): Promise<StubAnswer> {
  const fixture = JSON.parse(await readFile(`${FIXTURES}/${name}.json`, 'utf8')) as StubAnswer;
  const body = typeof fixture.body === 'object' && fixture.body !== null ? { ...fixture.body, ...overrides } : fixture.body;
  return { ...fixture, body };
}

export async function startGithubStub(options: { fallback?: boolean } = {}): Promise<GithubStub> {
  const fallbacks = options.fallback ? { GET: await recorded('get-missing'), PUT: await recorded('put-create') } : undefined;
  const queues = new Map<string, StubAnswer[]>();
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const path = req.url ?? '';
      const afterContents = path.slice(path.indexOf(CONTENTS) + CONTENTS.length);
      const file = decodeURIComponent(afterContents.split('?')[0] ?? '');
      const method = req.method ?? '';
      requests.push({ method, file, path, headers: req.headers, body: text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>) });

      const queue = queues.get(file);
      const answer = queue?.shift() ?? (queue === undefined && fallbacks ? fallbacks[method as 'GET' | 'PUT'] : undefined);
      if (!answer) {
        // Nothing scripted: a plain 500, which the client names unavailable, so a test that forgot an answer fails.
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"message":"no scripted answer"}');
        return;
      }
      const send = () => {
        res.statusCode = answer.status;
        for (const [name, value] of Object.entries(answer.headers)) res.setHeader(name, value);
        res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
      };
      if (answer.delayMs) setTimeout(send, answer.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    requestsFor: (file) => requests.filter((request) => request.file === file),
    script: (file, answers) => {
      queues.set(file, [...answers]);
    },
    reset: () => {
      queues.clear();
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
