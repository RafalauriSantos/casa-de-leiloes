import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from '../../src/app';
import { createDb, type Db } from '../../src/shared/db';
import { testConfig } from './test-config';

export interface TestServer {
  url: string;
  db: Db;
  close: () => Promise<void>;
}

/** A real HTTP server on an ephemeral port, backed by the real local database. */
export async function startTestServer(): Promise<TestServer> {
  const config = testConfig();
  const db = createDb(config.databaseUrl);
  const app = createApp({ config, db });

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => {
      resolve(s);
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    db,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await db.end();
    },
  };
}
