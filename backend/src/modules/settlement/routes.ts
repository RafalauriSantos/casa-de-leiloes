import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Config } from '../../config';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { settleDue } from './service';

function hasCronSecret(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function settlementRoutes(deps: { db: Db; config: Config }): Hono {
  return new Hono().post('/internal/close-due', async (c) => {
    if (!hasCronSecret(c.req.header('Authorization'), deps.config.cronSecret)) {
      throw new AppError('unauthenticated', 'Chamada interna não autorizada.');
    }
    const result = await settleDue(deps.db);
    // A lot that could not be settled is a failure for the caller, never an HTTP success.
    return c.json(result, result.failed > 0 ? 500 : 200);
  });
}
