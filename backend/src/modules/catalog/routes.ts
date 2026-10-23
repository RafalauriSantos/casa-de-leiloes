import { Hono } from 'hono';
import type { Config } from '../../config';
import { authMiddleware, type AuthEnv } from '../../shared/auth';
import type { Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { requireRole } from '../identity';
import { searchItems } from './met-client';
import { catalogSearchQuery } from './schemas';

export function catalogRoutes(deps: { db: Queryable; config: Config }): Hono<AuthEnv> {
  const { db, config } = deps;
  return new Hono<AuthEnv>().get(
    '/catalog/search',
    authMiddleware(config),
    requireRole(db, 'auctioneer', 'Apenas leiloeiros buscam itens para lotes.'),
    async (c) => {
      const query = catalogSearchQuery.safeParse({ q: c.req.query('q') ?? '' });
      if (!query.success) throw new AppError('validation_error', query.error.issues.map((issue) => issue.message).join(' '));
      return c.json(await searchItems(config.metApiUrl, query.data.q));
    },
  );
}
