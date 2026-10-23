import { serve } from '@hono/node-server';
import app from './index';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on http://localhost:${String(port)}/api`);
});
