import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../src/shared/db';
import { testConfig } from '../helpers/test-config';

let db: Db;
beforeAll(() => {
  db = createDb(testConfig().databaseUrl);
});
afterAll(async () => {
  await db.end();
});

describe('db pool resilience', () => {
  it('survives the server dropping an idle connection and keeps serving queries', async () => {
    const [row] = await db.query<{ pid: number }>('select pg_backend_pid() as pid');
    const killer = createDb(testConfig().databaseUrl);
    try {
      await killer.query('select pg_terminate_backend($1)', [row?.pid]);
    } finally {
      await killer.end();
    }
    // Give the pool time to notice. Without an error listener this becomes an uncaught exception.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await db.query<{ ok: number }>('select 1 as ok')).toEqual([{ ok: 1 }]);
  });
});
