import { Hono } from 'hono';
import type { Config } from '../../config';
import { authMiddleware, type AuthEnv } from '../../shared/auth';
import type { Db } from '../../shared/db';
import { requireRole } from '../identity';
import { settleEndedLedBy } from '../settlement';
import { getReceipt, listMyLots } from './service';

export function receiptRoutes(deps: { db: Db; config: Config }): Hono<AuthEnv> {
  const { db, config } = deps;

  return new Hono<AuthEnv>()
    // Public: the random code is the key to the receipt (D10), so the winner can share it as a link.
    .get('/receipts/:code', async (c) => c.json(await getReceipt(db, config, c.req.param('code'))))
    .use('/me/wins', authMiddleware(config), requireRole(db, 'bidder', 'Apenas licitantes têm arremates.'))
    .get('/me/wins', async (c) => {
      // A lot this bidder won and nobody has looked at yet is settled now, so its receipt is listed (D6).
      await settleEndedLedBy(db, config, c.get('userId'));
      return c.json(await listMyLots(db, c.get('userId')));
    });
}
