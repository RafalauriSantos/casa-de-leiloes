import { Hono } from 'hono';
import { z } from 'zod';
import type { Config } from '../../config';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { auditReport } from './service';

const uuid = z.uuid();
const head = z.string().regex(/^[0-9a-f]{64}$/);

/** The public audit (D22): no login, read-only, and it never settles a lot. */
export function auditRoutes(deps: { db: Db; config: Config }): Hono {
  const { db, config } = deps;
  return new Hono().get('/lots/:id/audit', async (c) => {
    // A bad head is refused before the lot is looked at, so it costs nothing.
    const asked = c.req.query('head');
    if (asked !== undefined && !head.safeParse(asked).success) {
      throw new AppError('validation_error', 'A ponta deve ter 64 caracteres hexadecimais em minúsculas.');
    }
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) throw new AppError('not_found', 'Lote não encontrado.');
    return c.json(await auditReport(db, config, id.data));
  });
}
