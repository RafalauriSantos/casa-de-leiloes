import pg from 'pg';

type Params = readonly unknown[];

export interface Queryable {
  query: <T extends pg.QueryResultRow>(text: string, params?: Params) => Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction: commit on success, rollback on any error. */
  tx: <R>(fn: (tx: Queryable) => Promise<R>) => Promise<R>;
  end: () => Promise<void>;
}

/** Money is integer cents in bigint columns; they are far below 2^53, so numbers are exact. */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('bigint out of the safe integer range');
  return parsed;
});

export function createDb(connectionString: string): Db {
  // Small pool: each serverless instance holds few connections; the transaction pooler does the rest.
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });

  const run = async <T extends pg.QueryResultRow>(
    target: Pick<pg.Pool | pg.PoolClient, 'query'>,
    text: string,
    params?: Params,
  ): Promise<T[]> => {
    const result = await target.query<T>(text, params ? [...params] : undefined);
    return result.rows;
  };

  return {
    query: (text, params) => run(pool, text, params),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => run(client, text, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
