import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Config } from '../../config';
import { AppError } from '../../shared/errors';

function hasCronSecret(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function settlementRoutes(deps: { config: Config }): Hono {
  return new Hono().post('/internal/close-due', (c) => {
    if (!hasCronSecret(c.req.header('Authorization'), deps.config.cronSecret)) {
      throw new AppError('unauthenticated', 'Chamada interna não autorizada.');
    }
    // Walking skeleton: there are no lots yet. Slice 4 replaces this with the real settlement.
    return c.json({ settled: 0 });
  });
}
