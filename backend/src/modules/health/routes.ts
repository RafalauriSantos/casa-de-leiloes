import { Hono } from 'hono';
import type { Queryable } from '../../shared/db';
import { checkHealth } from './service';

export function healthRoutes(deps: { db: Queryable }): Hono {
  return new Hono().get('/health', async (c) => c.json(await checkHealth(deps.db)));
}
