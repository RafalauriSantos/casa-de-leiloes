import { Hono } from 'hono';
import type { Config } from './config';
import type { Db } from './shared/db';
import { handleError, handleNotFound } from './shared/errors';
import { healthRoutes } from './modules/health';
import { identityRoutes } from './modules/identity';
import { settlementRoutes } from './modules/settlement';
import { walletRoutes } from './modules/wallet';
import { catalogRoutes } from './modules/catalog';
import { lotRoutes } from './modules/lots';
import { biddingRoutes } from './modules/bidding';
import { auditRoutes } from './modules/audit';

export function createApp(deps: { config: Config; db: Db }): Hono {
  const { config, db } = deps;
  const app = new Hono().basePath('/api');

  app.route('/', healthRoutes({ db }));
  app.route('/', identityRoutes({ db, config }));
  app.route('/', walletRoutes({ db, config }));
  app.route('/', catalogRoutes({ db, config }));
  app.route('/', lotRoutes({ db, config }));
  app.route('/', biddingRoutes({ db, config }));
  app.route('/', auditRoutes({ db, config }));
  app.route('/', settlementRoutes({ db, config }));

  app.onError(handleError);
  app.notFound(handleNotFound);
  return app;
}
