import { Hono } from 'hono';
import type { Config } from '../../config';
import { authMiddleware, optionalAuthMiddleware, type AuthEnv, type OptionalAuthEnv } from '../../shared/auth';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { requireRole } from '../identity';
import { bidBody } from './schemas';
import { liveView, placeBid } from './service';
import { z } from 'zod';

const uuid = z.uuid();

export function biddingRoutes(deps: { db: Db; config: Config }): Hono {
  const { db, config } = deps;
  // Two apps, so each route's typing is exact: the room's viewer may be anonymous, a bid's bidder never is.
  const room = new Hono<OptionalAuthEnv>().get('/lots/:id/live', optionalAuthMiddleware(config), async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) throw new AppError('not_found', 'Lote não encontrado.');
    return c.json(await liveView(db, config, id.data, c.get('userId')));
  });
  const bids = new Hono<AuthEnv>()
    .post(
      '/lots/:id/bids',
      authMiddleware(config),
      requireRole(db, 'bidder', 'Apenas licitantes dão lances.'),
      async (c) => {
        const id = uuid.safeParse(c.req.param('id'));
        if (!id.success) throw new AppError('not_found', 'Lote não encontrado.');
        const body = bidBody.safeParse(await c.req.json().catch(() => undefined));
        if (!body.success) throw new AppError('validation_error', 'Informe o lance em centavos, como número inteiro e positivo.');
        return c.json(await placeBid(db, config, c.get('userId'), id.data, body.data.amountCents), 201);
      },
    );
  return new Hono().route('/', room).route('/', bids);
}
