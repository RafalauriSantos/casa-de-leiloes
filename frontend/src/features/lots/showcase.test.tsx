import { randomBytes, randomUUID } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import pg from 'pg';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { fetchLots } from './api';
import { Showcase } from './components/Showcase';

// The Ao vivo tab shows its live dot only while a lot is open right now. Real API and Postgres, as in the other
// frontend tests. The shared database may hold lots from other tests, so the tests compare the dot with the live
// list instead of emptying it, and they cancel only the lots they made.

const made: string[] = [];

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<Record<string, unknown>>(text, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function auctioneerId(): Promise<string> {
  const email = `s-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) throw new Error(`sign-up failed: ${error?.message ?? 'no user'}`);
  await sql("update public.profiles set role = 'auctioneer' where id = $1", [data.user.id]);
  return data.user.id;
}

/** Inserts a lot whose window is `starts` to `ends` (SQL intervals from now) and returns its id. */
async function insertLot(starts: string, ends: string): Promise<string> {
  const [row] = await sql(
    `insert into public.lots (auctioneer_id, external_id, title, item_image_url, item_source_url, starts_at, ends_at, starting_bid_cents, increment_cents)
     values ($1, '1', $2, 'https://example.test/item.jpg', 'https://example.test/item', now() + $3::interval, now() + $4::interval, 50000, 5000)
     returning id`,
    [await auctioneerId(), `Lote de teste ${randomUUID().slice(0, 6)}`, starts, ends],
  );
  const id = String(row?.id);
  made.push(id);
  return id;
}

const liveLotsNow = async (): Promise<number> => (await fetchLots({ status: 'live' })).length;
const liveDotOn = (tab: string) => screen.getByRole('button', { name: tab }).querySelector('.live-dot') !== null;
/** The list has loaded when it shows a card or the empty hint. */
const listLoaded = () => screen.queryAllByRole('article').length > 0 || screen.queryByText(/Nenhum lote ao vivo agora/) !== null;

const renderShowcase = () => render(<MemoryRouter><Showcase /></MemoryRouter>);

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  try {
    if (made.length > 0) await sql("update public.lots set status = 'cancelled' where id = any($1::uuid[])", [made]);
  } finally {
    made.length = 0;
  }
});

describe('showcase: the Ao vivo dot shows only while a lot is open right now', () => {
  it('agrees with the live lots list', async () => {
    renderShowcase();
    await waitFor(() => { expect(listLoaded()).toBe(true); }, { timeout: 5_000 });
    const live = await liveLotsNow();
    await waitFor(() => { expect(liveDotOn('Ao vivo')).toBe(live > 0); }, { timeout: 5_000 });
  });

  it('lights the dot while a lot of its own is open', async () => {
    await insertLot('-1 hour', '1 hour');
    renderShowcase();
    await waitFor(() => { expect(liveDotOn('Ao vivo')).toBe(true); });
  });

  it('an ended lot does not light the dot: the check asks only for live lots', async () => {
    await insertLot('-2 hours', '-1 hour');
    // The spy only records the requests; each one still goes to the real API.
    const spy = vi.spyOn(globalThis, 'fetch');
    const lotRequests = () => spy.mock.calls.map(([url]) => urlOf(url)).filter((url) => url.startsWith('/api/lots'));
    renderShowcase();
    // The list (default tab) and the dot check both ask the API at mount: every such request must be the live one.
    await waitFor(() => { expect(lotRequests().length).toBeGreaterThanOrEqual(2); });
    for (const url of lotRequests()) expect(new URL(url, 'http://localhost').searchParams.get('status')).toBe('live');
  });

  it('the dot goes off when the live check fails, and never stays on from an earlier answer', async () => {
    await insertLot('-1 hour', '1 hour');
    renderShowcase();
    await waitFor(() => { expect(liveDotOn('Ao vivo')).toBe(true); });
    // Only the live requests fail from now on; every other request still reaches the real API.
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      urlOf(input).includes('status=live') ? Promise.reject(new TypeError('falha simulada na consulta ao vivo')) : real(input, init));
    await waitFor(() => { expect(liveDotOn('Ao vivo')).toBe(false); }, { timeout: 6_000 });
  });

  it('the other tabs never carry the dot, even while a lot is open', async () => {
    await insertLot('-1 hour', '1 hour');
    renderShowcase();
    await waitFor(() => { expect(listLoaded()).toBe(true); }, { timeout: 5_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Agendados' }));
    expect(liveDotOn('Agendados')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrados' }));
    expect(liveDotOn('Encerrados')).toBe(false);
  });
});

describe('showcase: a lot card shows its image, title, bid and time (2.2)', () => {
  /** Searches the showcase by the lot's unique title and returns the card that shows it. */
  async function cardFor(id: string): Promise<HTMLElement> {
    const [row] = await sql('select title from public.lots where id = $1', [id]);
    const title = String(row?.title);
    renderShowcase();
    fireEvent.change(screen.getByLabelText('Buscar por título'), { target: { value: title } });
    fireEvent.submit(screen.getByRole('search'));
    const heading = await screen.findByRole('heading', { name: title });
    const card = heading.closest('article');
    if (!card) throw new Error('the lot is not in a card');
    return card;
  }

  it('shows the starting bid until a bid arrives, then the current bid', async () => {
    const bidless = await insertLot('-1 minute', '1 hour');
    const bid = await insertLot('-1 minute', '1 hour');
    await sql('update public.lots set current_amount_cents = 55000 where id = $1', [bid]);

    const starting = await cardFor(bidless);
    expect(starting.querySelector('img')?.getAttribute('src')).toBe('https://example.test/item.jpg');
    expect(starting.textContent).toContain('Lance inicial R$ 500,00');
    expect(starting.textContent).toContain('Termina em');
    cleanup();

    const current = await cardFor(bid);
    expect(current.textContent).toContain('Lance atual R$ 550,00');
    expect(current.textContent).toContain('Termina em');
  });
});
