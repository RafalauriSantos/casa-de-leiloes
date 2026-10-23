import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * Stands in for the Met's public API on a local port. It serves the real responses captured in
 * tests/fixtures/met; anything else is a real 404. The production client runs unchanged against it.
 */
const FIXTURES = fileURLToPath(new URL('../fixtures/met', import.meta.url));

export interface MetStub {
  baseUrl: string;
  /** Makes every request fail with this status, like an upstream outage. */
  failWith: (status: number | undefined) => void;
  /** Makes only the object endpoint fail (search still answers), or answer a body of the wrong shape. */
  objectsMode: (mode: 'ok' | 'down' | 'garbage') => void;
  /** Makes one object fail with 503 while the others answer (a partial outage). */
  failObject: (id: number | undefined) => void;
  /** Holds object answers back, to make the external call slow. */
  delayObjectsMs: (ms: number) => void;
  close: () => Promise<void>;
}

export async function startMetStub(): Promise<MetStub> {
  let failure: number | undefined;
  let objects: 'ok' | 'down' | 'garbage' = 'ok';
  let failingObject: number | undefined;
  let delayMs = 0;
  const server: Server = createServer((req, res) => {
    void (async () => {
      res.setHeader('Content-Type', 'application/json');
      if (failure !== undefined) {
        res.statusCode = failure;
        res.end('{"message":"upstream failure"}');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://stub');
      if (url.pathname === '/public/collection/v1.1/search') {
        const q = url.searchParams.get('q') ?? '';
        const body = q.toLowerCase().includes('vase')
          ? await readFile(`${FIXTURES}/search-vase.json`, 'utf8')
          : JSON.stringify({ total: 0, objectIDs: null });
        res.end(body);
        return;
      }
      const object = /^\/public\/collection\/v1\/objects\/(\d+)$/.exec(url.pathname);
      if (object?.[1]) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (Number(object[1]) === failingObject) {
          res.statusCode = 503;
          res.end('{"message":"upstream failure"}');
          return;
        }
        if (objects === 'down') {
          res.statusCode = 503;
          res.end('{"message":"upstream failure"}');
          return;
        }
        if (objects === 'garbage') {
          res.end('{"hello":"world"}');
          return;
        }
        try {
          res.end(await readFile(`${FIXTURES}/objects/${object[1]}.json`, 'utf8'));
        } catch {
          res.statusCode = 404;
          res.end('{"message":"Not Found"}');
        }
        return;
      }
      res.statusCode = 404;
      res.end('{"message":"Not Found"}');
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/public/collection`,
    failWith: (status) => {
      failure = status;
    },
    objectsMode: (mode) => {
      objects = mode;
    },
    failObject: (id) => {
      failingObject = id;
    },
    delayObjectsMs: (ms) => {
      delayMs = ms;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
