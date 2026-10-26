import type { CatalogPage } from '@casa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let met: MetStub;
let auctioneer: TestUser;
let bidder: TestUser;

beforeAll(async () => {
  met = await startMetStub();
  server = await startTestServer({ metApiUrl: met.baseUrl });
  auctioneer = await createAuctioneer(server);
  bidder = await signUpUser();
});
afterAll(async () => {
  await server.close();
  await met.close();
});

const search = (q: string | null, user: TestUser | 'anonymous' = auctioneer, page?: number) => {
  const params = new URLSearchParams({ ...(q === null ? {} : { q }), ...(page === undefined ? {} : { page: String(page) }) });
  return fetch(`${server.url}/api/catalog/search?${params.toString()}`, { headers: user === 'anonymous' ? {} : { Authorization: `Bearer ${user.token}` } });
};

type SearchPage = CatalogPage;

describe('GET /api/catalog/search (auctioneers only)', () => {
  it('refuses an anonymous visitor with 401', async () => {
    expect((await search('vase', 'anonymous')).status).toBe(401);
  });

  it('refuses a bidder with 403', async () => {
    const response = await search('vase', bidder);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'forbidden', message: expect.any(String) as string });
  });

  it('refuses a missing or too short query with 422 before calling the catalog', async () => {
    expect((await search(null)).status).toBe(422);
    expect((await search('a')).status).toBe(422);
  });

  it('returns the public-domain items with an image, as the catalog presents them', async () => {
    const response = await search('vase');
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as SearchPage;
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.imageUrl).toMatch(/^https:\/\//);
      expect(item.sourceUrl).toMatch(/metmuseum\.org/);
      expect(item.externalId).toMatch(/^\d+$/);
    }
    // Items without a public image are skipped, not shown broken.
    expect(items.map((i) => i.externalId)).not.toContain('231170');
    expect(items.map((i) => i.externalId)).not.toContain('9334');
    expect(items.map((i) => i.externalId)).not.toContain('21642');
  });

  it('answers an empty result for a query with no matches', async () => {
    const response = await search('nothing-matches-this');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0, page: 1, pages: 0, hasNext: false });
  });

  it('pages through every result: page 2 holds the next twelve of the search, and the total is the whole collection', async () => {
    const response = await search('vase', auctioneer, 2);
    expect(response.status).toBe(200);
    const page = (await response.json()) as SearchPage;
    expect(page.page).toBe(2);
    expect(page.total).toBe(9229);
    expect(page.pages).toBe(770);
    expect(page.hasNext).toBe(true);
    // The Met's own first object of page 2 (the search's 13th id) is in it; the first page's ids are not.
    expect(page.items.map((i) => i.externalId)).toContain('9283');
    expect(page.items.map((i) => i.externalId)).not.toContain('205482');
  });

  it('answers an empty page with no next page past the last one, without asking the catalog for any item', async () => {
    const response = await search('vase', auctioneer, 800);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 9229, page: 800, pages: 770, hasNext: false });
  });

  it('answers the ninth page from the Met\'s own answer for that page: the objects it has an image for, and no more', async () => {
    const response = await search('vase', auctioneer, 9);
    const page = (await response.json()) as SearchPage;
    expect(page.items.map((i) => i.externalId)).toEqual(expect.arrayContaining(['20012', '204671', '17732', '187353']));
    // Seven of the twelve ids of this page have no small image in the Met's detail: they are left out, not shown broken.
    expect(page.items.length).toBe(5);
    expect(page.hasNext).toBe(true);
  });

  it('refuses a page that is not a positive whole number with 422', async () => {
    expect((await search('vase', auctioneer, 0)).status).toBe(422);
    expect((await fetch(`${server.url}/api/catalog/search?q=vase&page=1.5`, { headers: { Authorization: `Bearer ${auctioneer.token}` } })).status).toBe(422);
  });

  it('answers 503 catalog_unavailable when the catalog answers an error', async () => {
    met.failWith(503);
    try {
      const response = await search('vase');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'catalog_unavailable', message: expect.any(String) as string });
    } finally {
      met.failWith(undefined);
    }
  });

  it('answers 503 catalog_unavailable when the catalog is unreachable (real closed port, no stub)', async () => {
    const unreachable = await startTestServer({ metApiUrl: 'http://127.0.0.1:1/public/collection' });
    try {
      const response = await fetch(`${unreachable.url}/api/catalog/search?q=vase`, { headers: { Authorization: `Bearer ${auctioneer.token}` } });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { code: string }).code).toBe('catalog_unavailable');
    } finally {
      await unreachable.close();
    }
  });

  it('answers 503 when every item detail fails with an outage (search itself answers)', async () => {
    met.objectsMode('down');
    try {
      const response = await search('vase');
      expect(response.status).toBe(503);
      expect(((await response.json()) as { code: string }).code).toBe('catalog_unavailable');
    } finally {
      met.objectsMode('ok');
    }
  });

  it('answers 503 when only some item details fail: a partial list is never a complete answer', async () => {
    const baseline = (await (await search('vase')).json()) as SearchPage;
    const victim = Number(baseline.items[0]?.externalId);
    met.failObject(victim);
    try {
      const response = await search('vase');
      expect(response.status).toBe(503);
      expect(((await response.json()) as { code: string }).code).toBe('catalog_unavailable');
    } finally {
      met.failObject(undefined);
    }
  });

  it('answers 503 when the catalog answers a body of the wrong shape (never a made-up result)', async () => {
    met.objectsMode('garbage');
    try {
      const response = await search('vase');
      expect(response.status).toBe(503);
    } finally {
      met.objectsMode('ok');
    }
  });

  it('keeps working for everything else when the catalog is down (the showcase needs no catalog)', async () => {
    met.failWith(503);
    try {
      const response = await fetch(`${server.url}/api/lots`);
      expect(response.status).toBe(200);
    } finally {
      met.failWith(undefined);
    }
  });
});
