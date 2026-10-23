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

async function terminate(pid: number | undefined): Promise<boolean> {
  expect(pid).toBeDefined();
  const killer = createDb(testConfig().databaseUrl);
  try {
    const [result] = await killer.query<{ ok: boolean }>('select pg_terminate_backend($1) as ok', [pid]);
    return result?.ok ?? false;
  } finally {
    await killer.end();
  }
}

describe('db pool resilience', () => {
  it('survives the server dropping an idle connection and keeps serving queries', async () => {
    const [row] = await db.query<{ pid: number }>('select pg_backend_pid() as pid');
    expect(await terminate(row?.pid)).toBe(true);
    // Give the pool time to notice. Without an error listener this becomes an uncaught exception.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await db.query<{ ok: number }>('select 1 as ok')).toEqual([{ ok: 1 }]);
  });

  it('survives the connection dropping in the middle of a transaction: the transaction fails, the process lives', async () => {
    let killed = false;
    await expect(
      db.tx(async (tx) => {
        const [row] = await tx.query<{ pid: number }>('select pg_backend_pid() as pid');
        killed = await terminate(row?.pid);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.query('select 1');
      }),
    ).rejects.toThrow(/terminat/i);
    expect(killed).toBe(true);
    expect(await db.query<{ ok: number }>('select 1 as ok')).toEqual([{ ok: 1 }]);
  });
});
