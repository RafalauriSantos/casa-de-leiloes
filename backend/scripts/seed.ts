import { loadConfig } from '../src/config';
import { DEMO, seedDemo } from '../src/seed/demo';
import { createDb } from '../src/shared/db';

// `make seed`: the demo data for the brief (one auctioneer, two bidders with balance, one live lot with bids).
// Needs the API running (make dev) so the deposits and bids go through it. Running it again changes nothing.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run the seed through "make seed".`);
  return value;
}

const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);
const appUrl = (process.env.APP_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

try {
  const lotId = await seedDemo({
    db,
    appUrl,
    supabaseUrl: config.supabaseUrl,
    anonKey: required('VITE_SUPABASE_ANON_KEY'),
  });
  console.log(`seed ok: lote ${lotId}. Entre com ${DEMO.auctioneer} (leiloeiro) ou ${DEMO.bidders.join(' / ')}, senha ${DEMO.password}.`);
} finally {
  await db.end();
}
