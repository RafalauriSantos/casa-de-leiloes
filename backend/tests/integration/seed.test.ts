import type { AuditReport } from '@casa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo, DEMO } from '../../src/seed/demo';
import { signUpUser, promoteToAuctioneer } from '../helpers/auth';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { requireEnv } from '../helpers/test-config';

// B2 (criterion 8.1): one auctioneer, two bidders with balance, one live lot with bids. Running the seed again
// changes nothing: no duplicate accounts, deposits, lots or bids.

let server: TestServer;
let met: MetStub;

beforeAll(async () => {
  met = await startMetStub();
  server = await startTestServer({ metApiUrl: met.baseUrl });
  // The seed reuses a settled demo lot left by an earlier run of this shared database and skips creating it. Give those
  // an old title, so every run walks the whole seed (8.5), not only the first run on a fresh database.
  await server.db.query(
    `update public.lots l set title = l.title || ' (run ' || l.id || ')' from auth.users a
      where a.id = l.auctioneer_id and a.email = $1 and l.title = any($2::text[]) and l.settled_at is not null`,
    [DEMO.auctioneer, [DEMO.endedLotTitle, DEMO.tamperedLotTitle]],
  );
});
afterAll(async () => {
  await server.close();
  await met.close();
});

const deps = () => ({
  db: server.db,
  appUrl: server.url,
  supabaseUrl: requireEnv('SUPABASE_URL'),
  anonKey: requireEnv('SUPABASE_ANON_KEY'),
});

/**
 * The demo lot: the active one this demo auctioneer owns, as the seed picks it. Older demo lots may exist, cancelled by
 * the cleanup at the end of an earlier run, and another auctioneer may own a lot with the same title.
 */
const DEMO_LOT_SQL = `select l.id from public.lots l join auth.users u on u.id = l.auctioneer_id
                       where l.title = $1 and u.email = '${DEMO.auctioneer}' and l.status = 'active' and l.ends_at > now()
                       order by l.created_at desc limit 1`;
const DEMO_LOT_ID = `(${DEMO_LOT_SQL.replace(/\s+/g, ' ')})`;

async function counts() {
  const [row] = await server.db.query<{ accounts: number; lots: number; bids: number; deposited: number }>(
    `select (select count(*)::int from auth.users where email like '%@demo.example') as accounts,
            (select count(*)::int from public.lots l join auth.users a on a.id = l.auctioneer_id where a.email = $1) as lots,
            (select count(*)::int from public.bids b join public.lots l on l.id = b.lot_id
               join auth.users a on a.id = l.auctioneer_id where a.email = $1) as bids,
            (select coalesce(sum(w.total_cents), 0)::int from public.wallets w join auth.users u on u.id = w.user_id
              where u.email like '%@demo.example') as deposited`,
    [DEMO.auctioneer],
  );
  if (!row) throw new Error('count query returned nothing');
  return row;
}

describe('the seed (B2, 8.1)', () => {
  it('creates an auctioneer, two funded bidders and one live lot with bids', async () => {
    await seedDemo(deps());
    const [lot] = await server.db.query<{ status: string; live: boolean; bid_count: number; leader_id: string | null }>(
      `select status, (starts_at <= now() and ends_at > now()) as live, bid_count, leader_id
         from public.lots where id = ${DEMO_LOT_ID}`,
      [DEMO.lotTitle],
    );
    expect(lot).toMatchObject({ status: 'active', live: true });
    expect(lot?.bid_count).toBe(3);
    expect(lot?.leader_id).not.toBeNull();
    const [seeded] = await server.db.query<{ auctioneers: number; bidders: number }>(
      `select (select count(*)::int from public.profiles p join auth.users u on u.id = p.id
                where u.email = $1 and p.role = 'auctioneer') as auctioneers,
              (select count(*)::int from public.profiles p join auth.users u on u.id = p.id
                where u.email = any($2::text[]) and p.role = 'bidder') as bidders`,
      [DEMO.auctioneer, DEMO.bidders],
    );
    expect(seeded).toMatchObject({ auctioneers: 1, bidders: 2 });
    expect((await counts()).deposited).toBeGreaterThan(0);
  });

  it('also leaves an ended lot with a winner and a receipt, and a settled lot whose history was changed (8.5)', async () => {
    await seedDemo(deps());
    const [ended] = await server.db.query<{ code: string; winner: string }>(
      `select r.code, w.email as winner from public.receipts r join public.lots l on l.id = r.lot_id
         join auth.users a on a.id = l.auctioneer_id join auth.users w on w.id = r.winner_id
        where a.email = $1 and l.title = $2`,
      [DEMO.auctioneer, DEMO.endedLotTitle],
    );
    expect(ended?.winner).toBe(DEMO.bidders[0]);
    expect((await fetch(`${server.url}/api/receipts/${ended?.code ?? 'none'}`)).status).toBe(200);

    const [tampered] = await server.db.query<{ id: string; settled: boolean }>(
      `select l.id, l.settled_at is not null as settled
         from public.lots l join auth.users a on a.id = l.auctioneer_id where a.email = $1 and l.title = $2`,
      [DEMO.auctioneer, DEMO.tamperedLotTitle],
    );
    expect(tampered).toMatchObject({ settled: true });
    const audit = (await (await fetch(`${server.url}/api/lots/${tampered?.id ?? 'none'}/audit`)).json()) as AuditReport;
    expect(audit.headline.kind).toBe('tampered');
  });

  it('sells real variety: at least nine different Met objects across the demo lots (B23)', async () => {
    await seedDemo(deps());
    const [row] = await server.db.query<{ objects: number }>(
      `select count(distinct l.external_id)::int as objects from public.lots l join auth.users a on a.id = l.auctioneer_id
        where a.email = $1`,
      [DEMO.auctioneer],
    );
    expect(row?.objects).toBeGreaterThanOrEqual(9);
  });

  it('leaves another auctioneer\'s open lot with the same title alone', async () => {
    const stranger = await signUpUser();
    await promoteToAuctioneer(server.db, stranger.id);
    const [theirs] = await server.db.query<{ id: string }>(
      `insert into public.lots (auctioneer_id, external_id, title, item_image_url, item_source_url, starts_at, ends_at,
                                starting_bid_cents, increment_cents)
       values ($1, '1', $2, 'https://example.test/i.jpg', 'https://example.test/s', now() - interval '1 hour', now() + interval '1 day', 50000, 5000)
       returning id`,
      [stranger.id, DEMO.lotTitle],
    );
    const seededId = await seedDemo(deps());
    expect(seededId).not.toBe(theirs?.id);
    const [untouched] = await server.db.query<{ bid_count: number }>('select bid_count from public.lots where id = $1', [theirs?.id]);
    expect(untouched?.bid_count).toBe(0);
  });

  it('running it again creates nothing new', async () => {
    const before = await counts();
    const [lotBefore] = await server.db.query<{ id: string }>(DEMO_LOT_SQL, [DEMO.lotTitle]);
    await seedDemo(deps());
    expect(await counts()).toEqual(before);
    const [lotAfter] = await server.db.query<{ id: string }>(DEMO_LOT_SQL, [DEMO.lotTitle]);
    expect(lotAfter?.id).toBe(lotBefore?.id);
  });
});
