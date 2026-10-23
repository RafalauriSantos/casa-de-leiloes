// Entry point used by Vercel: the Hono app is the default export.
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './shared/db';

const config = loadConfig(process.env);

export default createApp({ config, db: createDb(config.databaseUrl) });
