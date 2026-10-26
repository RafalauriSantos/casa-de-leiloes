import { randomBytes, randomUUID } from 'node:crypto';

// `make e2e-prod`: walks the published site as a new visitor would, and fails with the step that broke.
// It signs up a new bidder, deposits, sees the live lot, is refused a too-low bid with the exact reason, bids,
// finds the lot in "Meus arremates" as leader, and opens its public audit. It needs no secret: only the public URL
// and the public Supabase key the site already ships.
// The receipt is not reached here: a receipt needs the lot to end, and the demo lot runs for 30 days.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Example: APP_URL=https://... SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... make e2e-prod`);
  return value.replace(/\/+$/, '');
}

const APP = required('APP_URL');
const SUPABASE = required('SUPABASE_URL');
const ANON = required('VITE_SUPABASE_ANON_KEY');

class StepFailed extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StepFailed(message);
}

async function call(path: string, init: { method?: string; token?: string; body?: unknown; key?: string } = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${APP}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.key ? { 'Idempotency-Key': init.key } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // keep the text
  }
  return { status: response.status, body };
}

interface LiveLot { id: string; title: string }

const steps: Array<[string, () => Promise<void>]> = [];
let token = '';
let lot: LiveLot | undefined;

steps.push(['cadastro de um novo licitante', async () => {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const response = await fetch(`${SUPABASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token?: string };
  check(response.ok && body.access_token, `o cadastro não abriu sessão (HTTP ${String(response.status)})`);
  token = body.access_token;
  const me = await call('/api/me', { token });
  check(me.status === 200, `GET /api/me respondeu ${String(me.status)} para o novo licitante`);
  check((me.body as { role?: string }).role === 'bidder', 'o novo cadastro não entrou como licitante');
}]);

steps.push(['carteira começa vazia e aceita um depósito', async () => {
  const before = await call('/api/wallet', { token });
  check(before.status === 200, `GET /api/wallet respondeu ${String(before.status)}`);
  check((before.body as { totalCents?: number }).totalCents === 0, 'a carteira nova não começou com saldo zero');
  const deposit = await call('/api/wallet/deposits', { method: 'POST', token, body: { amountCents: 1_000_000 }, key: randomUUID() });
  check(deposit.status === 201, `o depósito respondeu ${String(deposit.status)} (${JSON.stringify(deposit.body)})`);
  check((deposit.body as { totalCents?: number }).totalCents === 1_000_000, 'o depósito não creditou o valor');
}]);

steps.push(['o site mostra um lote ao vivo', async () => {
  const live = await call('/api/lots?status=live');
  check(live.status === 200, `a lista ao vivo respondeu ${String(live.status)}`);
  const lots = live.body as LiveLot[];
  check(Array.isArray(lots) && lots.length > 0, 'nenhum lote ao vivo: o seed precisa estar no ar (make seed)');
  lot = lots[0];
}]);

/** The minimum the server accepts right now, read from the live room (the list can be a moment old). */
async function nextMinimum(): Promise<number> {
  const live = await call(`/api/lots/${String(lot?.id)}/live`, { token });
  check(live.status === 200, `a sala ao vivo respondeu ${String(live.status)}`);
  return (live.body as { nextMinimumCents: number }).nextMinimumCents;
}

steps.push(['um lance abaixo do mínimo é recusado com o motivo', async () => {
  const minimum = await nextMinimum();
  const refused = await call(`/api/lots/${String(lot?.id)}/bids`, { method: 'POST', token, body: { amountCents: minimum - 1 } });
  check(refused.status === 422, `um lance abaixo do mínimo respondeu ${String(refused.status)}, não 422`);
  check((refused.body as { code?: string }).code === 'bid_below_minimum', 'a recusa não veio com o código bid_below_minimum');
}]);

steps.push(['um lance válido é aceito e o licitante lidera', async () => {
  const minimum = await nextMinimum();
  const placed = await call(`/api/lots/${String(lot?.id)}/bids`, { method: 'POST', token, body: { amountCents: minimum } });
  check(placed.status === 201, `o lance válido respondeu ${String(placed.status)} (${JSON.stringify(placed.body)})`);
  const mine = await call('/api/me/wins', { token });
  check(mine.status === 200, `GET /api/me/wins respondeu ${String(mine.status)}`);
  const entry = (mine.body as Array<{ lotId: string; outcome: string }>).find((item) => item.lotId === lot?.id);
  check(entry?.outcome === 'leading', 'o lote não aparece em "Meus arremates" como "leading"');
}]);

steps.push(['a auditoria pública do lote abre', async () => {
  const audit = await call(`/api/lots/${String(lot?.id)}/audit`);
  check(audit.status === 200, `a auditoria respondeu ${String(audit.status)}`);
  check(Array.isArray((audit.body as { bids?: unknown[] }).bids), 'a auditoria não trouxe a lista de lances');
}]);

async function main(): Promise<void> {
  let passed = 0;
  for (const [name, run] of steps) {
    try {
      await run();
      passed += 1;
      console.log(`ok   ${name}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro inesperado';
      console.log(`FAIL ${name}: ${reason}`);
      console.log(`${String(passed)} de ${String(steps.length)} passos passaram. Parou aqui.`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`${String(passed)} de ${String(steps.length)} passos passaram.`);
}

await main();
