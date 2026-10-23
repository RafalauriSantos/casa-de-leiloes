import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMetStub, type MetStub } from '../../backend/tests/helpers/met-stub';

export const API_PORT = 8789;
const REQUIRED = ['DATABASE_URL', 'SUPABASE_URL', 'AUDIT_HMAC_SECRET', 'CRON_SECRET', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

let api: ChildProcess | undefined;
let met: MetStub | undefined;

/**
 * Starts the real backend (real Postgres, real Auth) so UI tests run the whole flow, with no mocks.
 * The public catalog is the local stub that serves captured Met responses, so UI runs never depend
 * on the internet.
 */
export async function setup(): Promise<void> {
  for (const name of REQUIRED) {
    if (!process.env[name]) throw new Error(`${name} is not set. Run the tests through "make test".`);
  }
  const taken = await fetch(`http://127.0.0.1:${String(API_PORT)}/api/health`).then(() => true, () => false);
  if (taken) throw new Error(`Port ${String(API_PORT)} is already in use; stop that process so the tests do not run against it.`);

  met = await startMetStub();
  api = spawn(process.execPath, ['--import', 'tsx', 'src/dev-server.ts'], {
    cwd: fileURLToPath(new URL('../../backend', import.meta.url)),
    env: { ...process.env, PORT: String(API_PORT), MET_API_URL: met.baseUrl },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${String(API_PORT)}/api/health`).then((r) => r.ok, () => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The test API did not become healthy in 30 s.');
}

export async function teardown(): Promise<void> {
  api?.kill();
  await met?.close();
}
