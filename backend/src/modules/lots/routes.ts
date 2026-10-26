import { Hono } from 'hono';
import { z } from 'zod';
import type { Config } from '../../config';
import { authMiddleware, type AuthEnv } from '../../shared/auth';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { requireRole } from '../identity';
import { settleIfEnded } from '../settlement';
import { createLotInput, lotInput, lotsQuery } from './schemas';
import { auctioneerSummary, cancelLot, createLot, getPublicLot, listOwnLots, listPublicLots, updateLot } from './service';

const uuid = z.uuid();

async function jsonBody(body: Promise<unknown>): Promise<unknown> {
  return body.catch(() => undefined);
}

function invalid(error: z.ZodError): AppError {
  return new AppError('validation_error', error.issues.map((issue) => issue.message).join(' '));
}

export function lotRoutes(deps: { db: Db; config: Config }): Hono<AuthEnv> {
  const { db, config } = deps;
  const auctioneer = (): ReturnType<typeof requireRole> => requireRole(db, 'auctioneer', 'Apenas leiloeiros publicam e gerenciam lotes.');
  const guard = [authMiddleware(config), auctioneer()] as const;

  return new Hono<AuthEnv>()
    .get('/lots', async (c) => {
      const query = lotsQuery.safeParse({ status: c.req.query('status') || undefined, q: c.req.query('q') || undefined });
      if (!query.success) throw invalid(query.error);
      return c.json(await listPublicLots(db, query.data));
    })
    .get('/lots/:id', async (c) => {
      const id = uuid.safeParse(c.req.param('id'));
      if (!id.success) throw new AppError('not_found', 'Lote não encontrado.');
      await settleIfEnded(db, config, id.data);
      return c.json(await getPublicLot(db, id.data));
    })
    .post('/lots', ...guard, async (c) => {
      const body = createLotInput.safeParse(await jsonBody(c.req.json()));
      if (!body.success) throw invalid(body.error);
      return c.json(await createLot(db, config, c.get('userId'), body.data), 201);
    })
    .patch('/lots/:id', ...guard, async (c) => {
      const id = uuid.safeParse(c.req.param('id'));
      if (!id.success) throw new AppError('not_found', 'Lote não encontrado.');
      const body = lotInput.safeParse(await jsonBody(c.req.json()));
      if (!body.success) throw invalid(body.error);
      return c.json(await updateLot(db, c.get('userId'), id.data, body.data));
    })
    .post('/lots/:id/cancel', ...guard, async (c) => {
      const id = uuid.safeParse(c.req.param('id'));
      if (!id.success) throw new AppError('not_found', 'Lote não encontrado.');
      return c.json(await cancelLot(db, c.get('userId'), id.data));
    })
    .get('/auctioneer/lots', ...guard, async (c) => c.json(await listOwnLots(db, c.get('userId'))))
    .get('/auctioneer/summary', ...guard, async (c) => c.json(await auctioneerSummary(db, c.get('userId'))));
}
