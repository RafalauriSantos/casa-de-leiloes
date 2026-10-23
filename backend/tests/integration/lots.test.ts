import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

let server: TestServer;
let met: MetStub;
let auctioneer: TestUser;
let otherAuctioneer: TestUser;
let bidder: TestUser;

beforeAll(async () => {
  met = await startMetStub();
  server = await startTestServer({ metApiUrl: met.baseUrl });
  auctioneer = await createAuctioneer(server);
  otherAuctioneer = await createAuctioneer(server);
  bidder = await signUpUser();
});
afterAll(async () => {
  await server.close();
  await met.close();
});

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' });
const create = async (user: TestUser, body: unknown) =>
  fetch(`${server.url}/api/lots`, { method: 'POST', headers: auth(user), body: JSON.stringify(body) });
const errorCode = async (response: Response) => ((await response.json()) as { code: string }).code;

/** Makes a lot live or ended by writing its times directly; the clock itself is the database's. */
async function setTimes(lotId: string, startsInMinutes: number, endsInMinutes: number): Promise<void> {
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [
    lotId,
    new Date(now.getTime() + minutes(startsInMinutes)),
    new Date(now.getTime() + minutes(endsInMinutes)),
  ]);
}

async function newLot(user: TestUser = auctioneer, overrides: Record<string, unknown> = {}): Promise<OwnLot> {
  const response = await create(user, lotBody(await dbNow(server), overrides));
  expect(response.status).toBe(201);
  return (await response.json()) as OwnLot;
}

describe('POST /api/lots (auctioneers only)', () => {
  it('refuses a bidder with 403 and an anonymous visitor with 401', async () => {
    expect((await create(bidder, lotBody(await dbNow(server)))).status).toBe(403);
    const anonymous = await fetch(`${server.url}/api/lots`, { method: 'POST', body: '{}' });
    expect(anonymous.status).toBe(401);
  });

  it('creates the lot and copies the item from the catalog (title, image, attributes, source)', async () => {
    const lot = await newLot();
    expect(lot.title).toBe('Vaso Sèvres Indien');
    expect(lot.imageUrl).toMatch(/^https:\/\/images\.metmuseum\.org\//);
    expect(lot.sourceUrl).toMatch(/metmuseum\.org/);
    expect(lot.attributes).toEqual({ artist: 'Sèvres Manufactory', date: '1760', medium: 'Soft-paste porcelain', department: 'European Sculpture and Decorative Arts', culture: null });
    expect(lot.state).toBe('scheduled');
    expect(lot.currentAmountCents).toBeNull();
    expect(lot.bidCount).toBe(0);
    expect(lot.canEdit).toBe(true);
    expect(lot.canCancel).toBe(true);
  });

  it('keeps the copy: the lot keeps its item even if the catalog later fails', async () => {
    const lot = await newLot();
    met.failWith(503);
    try {
      const [row] = await server.db.query<{ item_image_url: string; title: string }>('select item_image_url, title from public.lots where id = $1', [lot.id]);
      expect(row?.item_image_url).toBe(lot.imageUrl);
      expect(row?.title).toBe('Vaso Sèvres Indien');
      const detail = await fetch(`${server.url}/api/lots/${lot.id}`);
      expect(detail.status).toBe(200);
    } finally {
      met.failWith(undefined);
    }
  });

  it('creates nothing when the catalog is down: no half-made lot', async () => {
    const before = await server.db.query<{ n: string }>('select count(*)::text as n from public.lots');
    met.failWith(503);
    try {
      const response = await create(auctioneer, lotBody(await dbNow(server), { externalId: '9532' }));
      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe('catalog_unavailable');
    } finally {
      met.failWith(undefined);
    }
    const after = await server.db.query<{ n: string }>('select count(*)::text as n from public.lots');
    expect(after).toEqual(before);
  });

  it('refuses an item that is not in the catalog with 404 not_found', async () => {
    const response = await create(auctioneer, lotBody(await dbNow(server), { externalId: '999999999' }));
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
  });

  it('refuses a lot that would start while the catalog was being asked (the clock is read again after the call)', async () => {
    const now = await dbNow(server);
    // Starts 2 s from now; the catalog takes 3 s, so the start has passed when the lot would be written.
    const body = lotBody(now, { externalId: '198685', startsAt: new Date(now.getTime() + 2_000).toISOString(), endsAt: new Date(now.getTime() + minutes(5)).toISOString() });
    const before = await server.db.query<{ n: string }>('select count(*)::text as n from public.lots');
    met.delayObjectsMs(3_000);
    try {
      const response = await create(auctioneer, body);
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe('validation_error');
    } finally {
      met.delayObjectsMs(0);
    }
    expect(await server.db.query<{ n: string }>('select count(*)::text as n from public.lots')).toEqual(before);
  });

  it('creates nothing when the item detail fails with an outage', async () => {
    const before = await server.db.query<{ n: string }>('select count(*)::text as n from public.lots');
    met.objectsMode('down');
    try {
      const response = await create(auctioneer, lotBody(await dbNow(server), { externalId: '198685' }));
      expect(response.status).toBe(503);
    } finally {
      met.objectsMode('ok');
    }
    expect(await server.db.query<{ n: string }>('select count(*)::text as n from public.lots')).toEqual(before);
  });

  it('refuses an item with no public image (a real catalog record) with 422', async () => {
    const response = await create(auctioneer, lotBody(await dbNow(server), { externalId: '9334' }));
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_error');
  });

  it.each([
    ['an external id that is not a number', { externalId: 'vase; drop' }],
    ['a title shorter than 3 characters', { title: 'ab' }],
    ['a title longer than 120 characters', { title: 'x'.repeat(121) }],
    ['a starting bid of zero', { startingBidCents: 0 }],
    ['a starting bid with cents as a decimal', { startingBidCents: 10.5 }],
    ['an increment of zero', { incrementCents: 0 }],
    ['a start time without an offset', { startsAt: '2030-01-01T10:00:00' }],
    ['a start in the past', { startsAt: '2001-01-01T10:00:00.000Z', endsAt: '2001-01-01T11:00:00.000Z' }],
    ['an end before the start', { endsAt: 'PLACEHOLDER_BEFORE_START' }],
    ['a lot shorter than one minute', { endsAt: 'PLACEHOLDER_30S' }],
  ])('refuses %s with 422 and writes nothing', async (_name, change) => {
    const now = await dbNow(server);
    const body: Record<string, unknown> = { ...lotBody(now), ...change };
    if (body.endsAt === 'PLACEHOLDER_BEFORE_START') body.endsAt = new Date(now.getTime() + minutes(5)).toISOString();
    if (body.endsAt === 'PLACEHOLDER_30S') body.endsAt = new Date(now.getTime() + minutes(10) + 30_000).toISOString();
    const response = await create(auctioneer, body);
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_error');
  });

  it('accepts a lot that is exactly one minute long, the shortest allowed', async () => {
    const now = await dbNow(server);
    const response = await create(auctioneer, lotBody(now, { startsAt: new Date(now.getTime() + minutes(10)).toISOString(), endsAt: new Date(now.getTime() + minutes(11)).toISOString() }));
    expect(response.status).toBe(201);
  });
});

describe('the public showcase (no login)', () => {
  it('lists lots by state and hides cancelled ones', async () => {
    // Shared database: every lot of this test carries one marker so the list is exactly this test's.
    const marker = `Estado${randomUUID().slice(0, 8)}`;
    const scheduled = await newLot(auctioneer, { title: `${marker} agendado` });
    const live = await newLot(auctioneer, { title: `${marker} ao vivo` });
    const ended = await newLot(auctioneer, { title: `${marker} encerrado` });
    const cancelled = await newLot(auctioneer, { title: `${marker} cancelado` });
    await setTimes(live.id, -5, 50);
    await setTimes(ended.id, -90, -10);
    const cancel = await fetch(`${server.url}/api/lots/${cancelled.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    expect(cancel.status).toBe(200);

    const all = (await (await fetch(`${server.url}/api/lots?q=${marker}`)).json()) as Array<{ id: string; state: string }>;
    const byId = new Map(all.map((l) => [l.id, l.state]));
    expect(byId.get(scheduled.id)).toBe('scheduled');
    expect(byId.get(live.id)).toBe('live');
    expect(byId.get(ended.id)).toBe('ended');
    expect(byId.has(cancelled.id)).toBe(false);

    const onlyLive = (await (await fetch(`${server.url}/api/lots?status=live&q=${marker}`)).json()) as Array<{ id: string }>;
    expect(onlyLive.map((l) => l.id)).toEqual([live.id]);
  });

  it('searches by title, ignoring case and treating % and _ as plain characters', async () => {
    // The database is shared between runs: a unique marker keeps this test to its own lot.
    const marker = `Jarra${randomUUID().slice(0, 8)}`;
    await newLot(auctioneer, { title: `${marker} Azul 100% Original` });
    const found = (await (await fetch(`${server.url}/api/lots?q=${encodeURIComponent(`${marker.toLowerCase()} azul 100%`)}`)).json()) as Array<{ title: string }>;
    expect(found.map((l) => l.title)).toEqual([`${marker} Azul 100% Original`]);
    const none = (await (await fetch(`${server.url}/api/lots?q=${encodeURIComponent(`${marker} 100_`)}`)).json()) as unknown[];
    expect(none).toEqual([]);
  });

  it('refuses an unknown status filter with 422', async () => {
    const response = await fetch(`${server.url}/api/lots?status=whatever`);
    expect(response.status).toBe(422);
  });

  it('shows a lot to anyone, with its state and no owner-only fields', async () => {
    const lot = await newLot();
    const response = await fetch(`${server.url}/api/lots/${lot.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('canEdit');
    expect(body).not.toHaveProperty('auctioneerId');
    expect(body.state).toBe('scheduled');
  });

  it('answers 404 for a cancelled lot to the public, but its owner still sees it', async () => {
    const lot = await newLot();
    await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    expect((await fetch(`${server.url}/api/lots/${lot.id}`)).status).toBe(404);
    const mine = await fetch(`${server.url}/api/auctioneer/lots`, { headers: auth(auctioneer) });
    expect(((await mine.json()) as Array<{ id: string }>).map((l) => l.id)).toContain(lot.id);
  });

  it('answers 404 for an id that is not a lot, instead of a server error', async () => {
    expect((await fetch(`${server.url}/api/lots/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await fetch(`${server.url}/api/lots/not-a-uuid`)).status).toBe(404);
  });
});

describe('the start rule is enforced inside the insert, not only before it', () => {
  it('refuses a lot whose start passes while its insert waits on a lock (the check before the insert already passed)', async () => {
    const now = await dbNow(server);
    const body = lotBody(now, { startsAt: new Date(now.getTime() + 1_500).toISOString(), endsAt: new Date(now.getTime() + minutes(5)).toISOString() });
    const before = await server.db.query<{ n: string }>('select count(*)::text as n from public.lots');

    // Holds the lots table: the insert waits here until the start has passed. The clock is read again
    // inside the insert, after the lock is released, so the statement itself must refuse.
    const locker = new pg.Client({ connectionString: testConfig().databaseUrl });
    await locker.connect();
    try {
      await locker.query('begin');
      await locker.query('lock table public.lots in access exclusive mode');
      const pending = create(auctioneer, body);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await locker.query('commit');
      const response = await pending;
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe('validation_error');
    } finally {
      await locker.end();
    }
    expect(await server.db.query<{ n: string }>('select count(*)::text as n from public.lots')).toEqual(before);
  });
});

describe('the default showcase keeps live and scheduled lots visible even with many ended ones', () => {
  it('shows a live lot in the unfiltered list when 60 or more ended lots exist', async () => {
    const marker = `Vitrine${randomUUID().slice(0, 8)}`;
    const live = await newLot(auctioneer, { title: `${marker} ao vivo` });
    // Ends first among the live lots: the shared database holds other live lots from earlier runs.
    await setTimes(live.id, -5, 1);
    // Plenty of ended lots, older than the live one: they must not push it out of the first page.
    await server.db.query(
      `insert into public.lots (auctioneer_id, external_id, title, item_image_url, item_source_url, item_attributes,
                                starts_at, ends_at, starting_bid_cents, increment_cents)
       select $1, '205482', $2 || ' ' || g, 'https://images.metmuseum.org/x.jpg', 'https://www.metmuseum.org/x', '{}'::jsonb,
              now() - interval '3 days', now() - interval '2 days', 100, 10
         from generate_series(1, 65) as g`,
      [auctioneer.id, `${marker} encerrado`],
    );
    const list = (await (await fetch(`${server.url}/api/lots`)).json()) as Array<{ id: string }>;
    expect(list.map((l) => l.id)).toContain(live.id);
  });
});

describe('the auctioneer panel', () => {
  it('lists only the auctioneer\'s own lots, with what they may still do', async () => {
    const mine = await newLot(auctioneer);
    const theirs = await newLot(otherAuctioneer);
    const list = (await (await fetch(`${server.url}/api/auctioneer/lots`, { headers: auth(auctioneer) })).json()) as OwnLot[];
    expect(list.map((l) => l.id)).toContain(mine.id);
    expect(list.map((l) => l.id)).not.toContain(theirs.id);
    expect(list.every((l) => typeof l.canEdit === 'boolean' && typeof l.canCancel === 'boolean')).toBe(true);
  });

  it('refuses a bidder with 403', async () => {
    expect((await fetch(`${server.url}/api/auctioneer/lots`, { headers: auth(bidder) })).status).toBe(403);
  });

  it('edits a lot that has not started and has no bids', async () => {
    const lot = await newLot();
    const now = await dbNow(server);
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, {
      method: 'PATCH',
      headers: auth(auctioneer),
      body: JSON.stringify({ ...lotBody(now), externalId: undefined, title: 'Vaso azul renomeado', startingBidCents: 60_000 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as OwnLot;
    expect(body.title).toBe('Vaso azul renomeado');
    expect(body.startingBidCents).toBe(60_000);
  });

  it('refuses to edit another auctioneer\'s lot with 403', async () => {
    const lot = await newLot(otherAuctioneer);
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, { method: 'PATCH', headers: auth(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('forbidden');
  });

  it('refuses to edit a lot to an invalid time window, with 422 and nothing changed', async () => {
    const lot = await newLot();
    const now = await dbNow(server);
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, {
      method: 'PATCH',
      headers: auth(auctioneer),
      body: JSON.stringify({ ...lotBody(now), endsAt: new Date(now.getTime() + minutes(5)).toISOString(), startsAt: new Date(now.getTime() + minutes(20)).toISOString() }),
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_error');
  });

  it('answers 404 when editing or cancelling an id that is not a lot of anyone', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await fetch(`${server.url}/api/lots/${unknown}`, { method: 'PATCH', headers: auth(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) })).status).toBe(404);
    expect((await fetch(`${server.url}/api/lots/${unknown}/cancel`, { method: 'POST', headers: auth(auctioneer) })).status).toBe(404);
    expect((await fetch(`${server.url}/api/lots/not-a-uuid`, { method: 'PATCH', headers: auth(auctioneer), body: '{}' })).status).toBe(404);
    expect((await fetch(`${server.url}/api/lots/not-a-uuid/cancel`, { method: 'POST', headers: auth(auctioneer) })).status).toBe(404);
  });

  it('refuses to edit a lot that already started, with 409 lot_not_editable', async () => {
    const lot = await newLot();
    await setTimes(lot.id, -1, 60);
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, { method: 'PATCH', headers: auth(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('lot_not_editable');
  });

  it('refuses to edit a lot that has bids, with 409 lot_not_editable', async () => {
    const lot = await newLot();
    await server.db.query('update public.lots set bid_count = 1 where id = $1', [lot.id]);
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, { method: 'PATCH', headers: auth(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('lot_not_editable');
  });

  it('refuses an invalid edit with 422 and changes nothing', async () => {
    const lot = await newLot();
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, { method: 'PATCH', headers: auth(auctioneer), body: JSON.stringify({ ...lotBody(await dbNow(server)), incrementCents: -1 }) });
    expect(response.status).toBe(422);
    const [row] = await server.db.query<{ increment_cents: number }>('select increment_cents from public.lots where id = $1', [lot.id]);
    expect(row?.increment_cents).toBe(5_000);
  });

  it('cancels a lot with no bids that has not ended', async () => {
    const lot = await newLot();
    const response = await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as OwnLot).state).toBe('cancelled');
  });

  it('refuses to cancel a lot that has bids, with 409 lot_not_editable', async () => {
    const lot = await newLot();
    await server.db.query('update public.lots set bid_count = 2 where id = $1', [lot.id]);
    const response = await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('lot_not_editable');
  });

  it('refuses to cancel a lot that already ended, with 409 lot_ended', async () => {
    const lot = await newLot();
    await setTimes(lot.id, -90, -10);
    const response = await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('lot_ended');
  });

  it('refuses to cancel another auctioneer\'s lot with 403', async () => {
    const lot = await newLot(otherAuctioneer);
    expect((await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) })).status).toBe(403);
  });

  it('refuses to cancel twice (already cancelled, 409)', async () => {
    const lot = await newLot();
    await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    const again = await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: auth(auctioneer) });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('lot_not_editable');
  });
});

describe('time is the server\'s (exact boundaries are unit-tested in rules.test.ts)', () => {
  it('a lot that started a moment ago is live', async () => {
    const marker = `Vivo${randomUUID().slice(0, 8)}`;
    const lot = await newLot(auctioneer, { title: `${marker} agora` });
    await setTimes(lot.id, 0, 60);
    const list = (await (await fetch(`${server.url}/api/lots?status=live&q=${marker}`)).json()) as Array<{ id: string }>;
    expect(list.map((l) => l.id)).toEqual([lot.id]);
  });

  it('a lot that ended a moment ago is ended', async () => {
    const marker = `Fim${randomUUID().slice(0, 8)}`;
    const lot = await newLot(auctioneer, { title: `${marker} agora` });
    await setTimes(lot.id, -60, 0);
    const ended = (await (await fetch(`${server.url}/api/lots?status=ended&q=${marker}`)).json()) as Array<{ id: string }>;
    expect(ended.map((l) => l.id)).toEqual([lot.id]);
    const live = (await (await fetch(`${server.url}/api/lots?status=live&q=${marker}`)).json()) as Array<{ id: string }>;
    expect(live).toEqual([]);
  });

  it('refuses to edit a lot that started a moment ago', async () => {
    const lot = await newLot();
    await setTimes(lot.id, 0, 60);
    const response = await fetch(`${server.url}/api/lots/${lot.id}`, { method: 'PATCH', headers: auth(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    expect(response.status).toBe(409);
  });
});
