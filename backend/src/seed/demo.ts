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
  /** B17: an ended lot with a winner and a receipt, so "Meus arremates" has something right after the seed. */
  endedLotTitle: 'Vaso de demonstração (arrematado)',
  /** B18: a settled lot whose history the seed changes in the database, so the audit shows "adulterado". */
  tamperedLotTitle: 'Vaso de demonstração (histórico adulterado)',
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

/** Creates the demo data if it is missing; a second run changes nothing. Returns the live lot's id. */
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
  const [first, second] = bidders;
  if (!first || !second) throw new Error('seed: the two demo bidders are missing');

  const liveLotId = await liveLot(deps, auctioneer.id, first, second);
  for (const item of VARIETY_ITEMS) await scheduledLot(deps, auctioneer.id, item);
  await settledLot(deps, auctioneer.id, ENDED_ITEM, first, second);
  await tamperFirstBid(deps, await settledLot(deps, auctioneer.id, TAMPERED_ITEM, first, second));
  return liveLotId;
}

interface DemoItem {
  title: string;
  externalId: string;
  imageUrl: string;
  sourceUrl: string;
}

const LIVE_ITEM: DemoItem = {
  title: DEMO.lotTitle,
  externalId: '5991',
  imageUrl: 'https://images.metmuseum.org/CRDImages/es/web-large/ES5991.jpg',
  sourceUrl: 'https://www.metmuseum.org/art/collection',
};
const ENDED_ITEM: DemoItem = {
  title: DEMO.endedLotTitle,
  externalId: '198685',
  imageUrl: 'https://images.metmuseum.org/CRDImages/es/original/DP-15275-023.jpg',
  sourceUrl: 'https://www.metmuseum.org/art/collection/search/198685',
};
/**
 * B23: real objects of other kinds, from the Met's public API (the same data the app copies when a lot is created).
 * Each becomes a lot that starts tomorrow, so the catalog shows more than vases.
 */
const VARIETY_ITEMS: readonly DemoItem[] = [
  { title: 'Carriage Clock', externalId: '1454', imageUrl: 'https://images.metmuseum.org/CRDImages/ad/web-large/233549.jpg', sourceUrl: 'https://www.metmuseum.org/art/collection/search/1454' },
  { title: 'Sword', externalId: '27513', imageUrl: 'https://images.metmuseum.org/CRDImages/aa/web-large/LC-54_46_8-004.jpg', sourceUrl: 'https://www.metmuseum.org/art/collection/search/27513' },
  { title: 'Chair', externalId: '14430', imageUrl: 'https://images.metmuseum.org/CRDImages/ad/web-large/DT181.jpg', sourceUrl: 'https://www.metmuseum.org/art/collection/search/14430' },
  { title: 'Teapot', externalId: '8356', imageUrl: 'https://images.metmuseum.org/CRDImages/ad/web-large/DP164167.jpg', sourceUrl: 'https://www.metmuseum.org/art/collection/search/8356' },
  { title: 'Box with lid', externalId: '316540', imageUrl: 'https://images.metmuseum.org/CRDImages/ao/web-large/vs1991_17_69.jpg', sourceUrl: 'https://www.metmuseum.org/art/collection/search/316540' },
  { title: 'Clock', externalId: '14696', imageUrl: 'https://images.metmuseum.org/CRDImages/ad/web-large/ADA6141.jpg', sourceUrl: 'https://www.metmuseum.org/art/collection/search/14696' },
];

const TAMPERED_ITEM: DemoItem = {
  title: DEMO.tamperedLotTitle,
  externalId: '205922',
  imageUrl: 'https://images.metmuseum.org/CRDImages/es/original/DP168387.jpg',
  sourceUrl: 'https://www.metmuseum.org/art/collection/search/205922',
};

/** How long the seed waits for a settlement that waits for the public anchor (D21): up to 5 minutes. */
const SETTLE_ATTEMPTS = 60;
const SETTLE_WAIT_MS = 5_000;
/** The amount written over the tampered lot's first bid: plainly not what was bid (B18). */
const TAMPERED_AMOUNT_CENTS = 999_900;

/** The live lot (8.1): three bids in turn, each one above the leader plus the increment; bidder 1 leads at the end. */
async function liveLot(deps: SeedDeps, auctioneerId: string, first: Account, second: Account): Promise<string> {
  // Only this demo auctioneer's lot counts: another auctioneer's lot with the same title is never reused.
  const [existing] = await deps.db.query<{ id: string; bid_count: number }>(
    'select id, bid_count from public.lots where title = $1 and auctioneer_id = $2 and status = $3 and ends_at > now() limit 1',
    [DEMO.lotTitle, auctioneerId, 'active'],
  );
  if (existing && existing.bid_count > 0) return existing.id;

  const lotId = existing?.id ?? (await createLot(deps, auctioneerId, LIVE_ITEM));
  await placeBids(deps, lotId, [[first, 50_000], [second, 55_000], [first, 60_000]]);
  return lotId;
}

/**
 * A lot that ends after two bids and is settled the way any ended lot is: bidder 2 bids, bidder 1 wins and gets a
 * receipt (B17). A lot only takes bids while live, so its end is then moved to now in the database. Where the public
 * anchor is on, the settlement waits for the last bid to be published (D21), so this opens the lot until it is settled.
 */
async function settledLot(deps: SeedDeps, auctioneerId: string, item: DemoItem, first: Account, second: Account): Promise<string> {
  const [existing] = await deps.db.query<{ id: string; bid_count: number; settled: boolean }>(
    `select id, bid_count, settled_at is not null as settled from public.lots
      where title = $1 and auctioneer_id = $2 and status = 'active' order by created_at desc limit 1`,
    [item.title, auctioneerId],
  );
  if (existing?.settled) return existing.id;
  // A run that died between the two bids left a lot that would end with the wrong winner: stop instead of settling it.
  if (existing && existing.bid_count !== 0 && existing.bid_count !== 2) {
    throw new Error(`seed: the lot ${existing.id} has ${String(existing.bid_count)} bid(s) from an interrupted run; cancel it and run the seed again`);
  }

  const lotId = existing?.id ?? (await createLot(deps, auctioneerId, item));
  if (!existing || existing.bid_count === 0) await placeBids(deps, lotId, [[second, 50_000], [first, 55_000]]);
  await deps.db.query('update public.lots set ends_at = now() where id = $1 and ends_at > now()', [lotId]);

  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    // Opening an ended lot settles it on demand.
    const opened = await api(deps, `/api/lots/${lotId}`, first.token);
    if (!opened.ok) throw new Error(`seed: opening the lot ${lotId} answered ${String(opened.status)}`);
    const [row] = await deps.db.query<{ settled: boolean }>('select settled_at is not null as settled from public.lots where id = $1', [lotId]);
    if (row?.settled) return lotId;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_WAIT_MS));
  }
  throw new Error(`seed: the lot ${lotId} was not settled in time; is the cron publishing the anchor?`);
}

/**
 * B18: overwrites the first bid's amount directly in the database, as someone with database access would, past the
 * trigger that refuses updates (defence in depth, D3). It runs only on a settled lot, whose bids the settlement already
 * waited to see published, so no money and no pending publication depend on it. Running it again changes nothing.
 */
async function tamperFirstBid(deps: SeedDeps, lotId: string): Promise<void> {
  await deps.db.tx(async (tx) => {
    await tx.query('set local session_replication_role = replica');
    await tx.query('update public.bids set amount_cents = $2 where lot_id = $1 and seq = 1 and amount_cents <> $2', [lotId, TAMPERED_AMOUNT_CENTS]);
  });
}

async function placeBids(deps: SeedDeps, lotId: string, bids: readonly (readonly [Account, number])[]): Promise<void> {
  for (const [bidder, amountCents] of bids) {
    const placed = await api(deps, `/api/lots/${lotId}/bids`, bidder.token, { method: 'POST', body: { amountCents } });
    if (placed.status !== 201) throw new Error(`seed: bid of ${String(amountCents)} answered ${String(placed.status)}`);
  }
}

/** A lot that started an hour ago and ends in 30 days. Its item is copied in, as the app does for every lot. */
async function createLot(deps: SeedDeps, auctioneerId: string, item: DemoItem): Promise<string> {
  return insertLot(deps, auctioneerId, item, "now() - interval '1 hour'");
}

/** B23: a real Met object that starts tomorrow, with no bids, so it shows under "Agendados". Idempotent per item. */
async function scheduledLot(deps: SeedDeps, auctioneerId: string, item: DemoItem): Promise<string> {
  const [existing] = await deps.db.query<{ id: string }>(
    'select id from public.lots where auctioneer_id = $1 and external_id = $2 and status = $3 limit 1',
    [auctioneerId, item.externalId, 'active'],
  );
  return existing?.id ?? insertLot(deps, auctioneerId, item, "now() + interval '1 day'");
}

async function insertLot(deps: SeedDeps, auctioneerId: string, item: DemoItem, startsAt: string): Promise<string> {
  const [row] = await deps.db.query<{ id: string }>(
    `insert into public.lots (auctioneer_id, external_id, title, item_image_url, item_source_url, item_attributes,
                              starts_at, ends_at, starting_bid_cents, increment_cents)
     values ($1, $2, $3, $4, $5, '{}', ${startsAt}, now() + interval '30 days', 50000, 5000)
     returning id`,
    [auctioneerId, item.externalId, item.title, item.imageUrl, item.sourceUrl],
  );
  if (!row) throw new Error('seed: the lot was not created');
  return row.id;
}
