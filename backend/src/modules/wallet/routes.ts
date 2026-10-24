import { Hono } from 'hono';
import type { Config } from '../../config';
import { authMiddleware, type AuthEnv } from '../../shared/auth';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { requireRole } from '../identity';
import { settleEndedLedBy } from '../settlement';
import { depositBody, idempotencyKey } from './schemas';
import { deposit, getWallet } from './service';

export function walletRoutes(deps: { db: Db; config: Config }): Hono<AuthEnv> {
  const { db, config } = deps;

  return new Hono<AuthEnv>()
    .use('/wallet/*', authMiddleware(config), requireRole(db, 'bidder', 'Apenas licitantes têm carteira.'))
    .get('/wallet', async (c) => {
      await settleEndedLedBy(db, config, c.get('userId'));
      return c.json(await getWallet(db, c.get('userId')));
    })
    .post('/wallet/deposits', async (c) => {
      const key = idempotencyKey.safeParse(c.req.header('Idempotency-Key'));
      if (!key.success) throw new AppError('validation_error', 'Envie um cabeçalho Idempotency-Key com um UUID.');

      const body = depositBody.safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) throw new AppError('validation_error', 'Informe o valor do depósito em centavos, como número inteiro.');

      const { wallet, replayed } = await deposit(db, c.get('userId'), body.data.amountCents, key.data);
      return c.json(wallet, replayed ? 200 : 201);
    });
}
