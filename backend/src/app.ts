import { Hono } from 'hono';
import type { Config } from './config';
import type { Db } from './shared/db';
import { handleError, handleNotFound } from './shared/errors';
import { healthRoutes } from './modules/health';
import { identityRoutes } from './modules/identity';
import { settlementRoutes } from './modules/settlement';

export function createApp(deps: { config: Config; db: Db }): Hono {
  const { config, db } = deps;
  const app = new Hono().basePath('/api');

  app.route('/', healthRoutes({ db }));
  app.route('/', identityRoutes({ db, config }));
  app.route('/', settlementRoutes({ config }));

  app.onError(handleError);
  app.notFound(handleNotFound);
  return app;
}
