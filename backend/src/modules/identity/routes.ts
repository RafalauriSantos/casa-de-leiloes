import { Hono } from 'hono';
import type { Config } from '../../config';
import { authMiddleware, type AuthEnv } from '../../shared/auth';
import type { Queryable } from '../../shared/db';
import { getMe } from './service';

export function identityRoutes(deps: { db: Queryable; config: Config }): Hono<AuthEnv> {
  return new Hono<AuthEnv>().use('/me', authMiddleware(deps.config)).get('/me', async (c) => c.json(await getMe(deps.db, c.get('userId'))));
}
