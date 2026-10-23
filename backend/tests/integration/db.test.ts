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

describe('db', () => {
  it('returns bigint columns as exact numbers', async () => {
    const [row] = await db.query<{ n: number }>('select 123456789012::bigint as n');
    expect(row?.n).toBe(123_456_789_012);
  });

  it('refuses a bigint beyond the safe integer range instead of rounding money', async () => {
    await expect(db.query('select 9007199254740993::bigint as n')).rejects.toThrow('safe integer');
  });

  it('commits a transaction that succeeds', async () => {
    await db.query('create table public.tx_probe (n int)');
    try {
      await db.tx(async (tx) => { await tx.query('insert into public.tx_probe values (1)'); });
      expect(await db.query('select n from public.tx_probe')).toEqual([{ n: 1 }]);
    } finally {
      await db.query('drop table public.tx_probe');
    }
  });

  it('rolls back everything when a statement in the transaction fails', async () => {
    await db.query('create table public.tx_probe (n int primary key)');
    try {
      await expect(
        db.tx(async (tx) => {
          await tx.query('insert into public.tx_probe values (1)');
          await tx.query('insert into public.tx_probe values (1)');
        }),
      ).rejects.toThrow();
      expect(await db.query('select n from public.tx_probe')).toEqual([]);
    } finally {
      await db.query('drop table public.tx_probe');
    }
  });
});
