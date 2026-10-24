// Entry point used by Vercel: the Hono app is the default export.
import type { Hono } from 'hono';
import { createApp } from './create-app';
import { loadConfig } from './config';
import { createDb } from './shared/db';

const config = loadConfig(process.env);
console.log(`anchor mode: ${config.anchor.mode}`);
const app: Hono = createApp({ config, db: createDb(config.databaseUrl) });

export default app;
