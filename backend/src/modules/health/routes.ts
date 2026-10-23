import { Hono } from 'hono';
import type { HealthResponse } from '@casa/contracts';
import type { Queryable } from '../../shared/db';

export function healthRoutes(deps: { db: Queryable }): Hono {
  return new Hono().get('/health', async (c) => {
    // A database failure throws and becomes a 500: never a fake "ok".
    await deps.db.query('select 1');
    const body: HealthResponse = { status: 'ok', database: 'ok' };
    return c.json(body);
  });
}
