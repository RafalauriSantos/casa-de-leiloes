import type { Queryable } from './db';

/** The only clock the business uses: the database's, never this machine's. A missing clock is an error, never a guessed time. */
export async function databaseNow(db: Queryable): Promise<Date> {
  const [row] = await db.query<{ now: Date }>('select clock_timestamp() as now');
  if (!row) throw new Error('database clock unavailable');
  return row.now;
}
