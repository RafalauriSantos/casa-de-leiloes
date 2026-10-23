import type { HealthResponse } from '@casa/contracts';
import type { Queryable } from '../../shared/db';

/** A database failure throws and becomes a 500: never a fake "ok". */
export async function checkHealth(db: Queryable): Promise<HealthResponse> {
  await db.query('select 1');
  return { status: 'ok', database: 'ok' };
}
