import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../src/shared/db';
import { testConfig } from '../helpers/test-config';

/**
 * Walking-skeleton risk check: the bid pattern (row lock, read, append, update) must stay
 * consistent under parallel transactions. Runs on the real database; set DATABASE_URL to the
 * hosted transaction pooler to prove the same through it.
 */
let db: Db;
beforeAll(async () => {
  db = createDb(testConfig().databaseUrl);
  await db.query('drop table if exists public.spike_bid, public.spike_lot');
  await db.query('create table public.spike_lot (id int primary key, head_seq int not null)');
  await db.query('create table public.spike_bid (lot_id int not null, seq int not null, primary key (lot_id, seq))');
  await db.query('insert into public.spike_lot values (1, 0)');
});
afterAll(async () => {
  await db.query('drop table if exists public.spike_bid, public.spike_lot');
  await db.end();
});

describe('row lock under parallel transactions', () => {
  it('appends 20 bids with contiguous sequence numbers and no lost update', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        db.tx(async (tx) => {
          const [lot] = await tx.query<{ head_seq: number }>('select head_seq from public.spike_lot where id = 1 for update');
          const next = (lot?.head_seq ?? 0) + 1;
          await tx.query('insert into public.spike_bid (lot_id, seq) values (1, $1)', [next]);
          await tx.query('update public.spike_lot set head_seq = $1 where id = 1', [next]);
        }),
      ),
    );

    const seqs = await db.query<{ seq: number }>('select seq from public.spike_bid where lot_id = 1 order by seq');
    expect(seqs.map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const [lot] = await db.query<{ head_seq: number }>('select head_seq from public.spike_lot where id = 1');
    expect(lot?.head_seq).toBe(20);
  });
});
