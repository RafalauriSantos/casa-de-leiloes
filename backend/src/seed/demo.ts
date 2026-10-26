import { DEMO_ACCOUNTS } from '@casa/contracts';
import type { Db } from '../shared/db';

/**
 * The demo data the brief asks for (criterion 8.1): one auctioneer, two bidders with balance, one live lot with bids.
 * Accounts are real Supabase Auth users and bids go through the real API, so the chain is valid. The accounts and their
 * shared password come from the contracts, because the login screen offers them too.
 */
export const DEMO = {
  ...DEMO_ACCOUNTS,
  lotTitle: 'Vaso de demonstração (Sèvres)',
  depositCents: 1_000_000,
} as const;

/** Fixed keys, so a second run replays the deposits instead of crediting twice. */
const DEPOSIT_KEYS = ['5f1c2a7e-0b3d-4c8a-9e21-6a7b8c9d0e01', '5f1c2a7e-0b3d-4c8a-9e21-6a7b8c9d0e02'] as const;

export interface SeedDeps {
  db: Db;
  /** The running API, for the deposits and the bids. */
  appUrl: string;
  supabaseUrl: string;
  anonKey: string;
}

interface Account {
  id: string;
  token: string;
}

interface AuthResponse {
  access_token?: string;
  user?: { id: string };
}

/** Signs the demo account up, or signs it in when it already exists: the same account on every run. */
async function account(deps: SeedDeps, email: string): Promise<Account> {
  const headers = { 'Content-Type': 'application/json', apikey: deps.anonKey };
  const body = JSON.stringify({ email, password: DEMO.password });
  const signUp = await fetch(`${deps.supabaseUrl}/auth/v1/signup`, { method: 'POST', headers, body });
  const created = signUp.ok ? ((await signUp.json()) as AuthResponse) : undefined;
  if (created?.access_token && created.user) return { id: created.user.id, token: created.access_token };

  const signIn = await fetch(`${deps.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers, body });
  if (!signIn.ok) throw new Error(`seed: could not sign in ${email} (${String(signIn.status)})`);
  const session = (await signIn.json()) as AuthResponse;
  if (!session.access_token || !session.user) throw new Error(`seed: no session for ${email}`);
  return { id: session.user.id, token: session.access_token };
}

async function api(deps: SeedDeps, path: string, token: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<Response> {
  return fetch(`${deps.appUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.key ? { 'Idempotency-Key': init.key } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Creates the demo data if it is missing; a second run changes nothing. Returns the lot id. */
export async function seedDemo(deps: SeedDeps): Promise<string> {
  const auctioneer = await account(deps, DEMO.auctioneer);
  await deps.db.query("update public.profiles set role = 'auctioneer' where id = $1", [auctioneer.id]);

  const bidders: Account[] = [];
  for (const [index, email] of DEMO.bidders.entries()) {
    const bidder = await account(deps, email);
    const deposit = await api(deps, '/api/wallet/deposits', bidder.token, {
      method: 'POST',
      body: { amountCents: DEMO.depositCents },
      key: DEPOSIT_KEYS[index],
    });
    if (deposit.status !== 201 && deposit.status !== 200) throw new Error(`seed: deposit for ${email} answered ${String(deposit.status)}`);
    bidders.push(bidder);
  }

  // Only this demo auctioneer's lot counts: another auctioneer's lot with the same title is never reused.
  const [existing] = await deps.db.query<{ id: string; bid_count: number }>(
    'select id, bid_count from public.lots where title = $1 and auctioneer_id = $2 and status = $3 and ends_at > now() limit 1',
    [DEMO.lotTitle, auctioneer.id, 'active'],
  );
  if (existing && existing.bid_count > 0) return existing.id;

  const lotId = existing?.id ?? (await createLot(deps, auctioneer.id));
  // Three bids in turn, each one above the leader plus the increment: bidder 1, bidder 2, bidder 1 leads at the end.
  const [first, second] = bidders;
  if (!first || !second) throw new Error('seed: the two demo bidders are missing');
  for (const [bidder, amountCents] of [[first, 50_000], [second, 55_000], [first, 60_000]] as const) {
    const placed = await api(deps, `/api/lots/${lotId}/bids`, bidder.token, { method: 'POST', body: { amountCents } });
    if (placed.status !== 201) throw new Error(`seed: bid of ${String(amountCents)} answered ${String(placed.status)}`);
  }
  return lotId;
}

/** A live lot that started an hour ago and ends in 30 days. Its item is copied in, as the app does for every lot. */
async function createLot(deps: SeedDeps, auctioneerId: string): Promise<string> {
  const [row] = await deps.db.query<{ id: string }>(
    `insert into public.lots (auctioneer_id, external_id, title, item_image_url, item_source_url, item_attributes,
                              starts_at, ends_at, starting_bid_cents, increment_cents)
     values ($1, '5991', $2, 'https://images.metmuseum.org/CRDImages/es/web-large/ES5991.jpg',
             'https://www.metmuseum.org/art/collection', '{}',
             now() - interval '1 hour', now() + interval '30 days', 50000, 5000)
     returning id`,
    [auctioneerId, DEMO.lotTitle],
  );
  if (!row) throw new Error('seed: the lot was not created');
  return row.id;
}
