import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { CatalogSearch } from './components/CatalogSearch';
import { Showcase } from './components/Showcase';

// The screens' failure states (1.4 and 2.5). Real API, Postgres and Auth. Each test makes only the named request fail
// through a fetch spy; every other request goes to the real API.

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

const failing = (message: string, status: number, code: string) =>
  new Response(JSON.stringify({ code, message }), { status, headers: { 'Content-Type': 'application/json' } });

/** Only auctioneers may search the catalog, so the test signs in as one. */
async function auctioneerToken(): Promise<string> {
  const email = `cat-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const { data: signUp, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError || !signUp.user) throw new Error(`sign-up failed: ${signUpError?.message ?? 'no user'}`);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("update public.profiles set role = 'auctioneer' where id = $1", [signUp.user.id]);
  } finally {
    await client.end();
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return data.session.access_token;
}

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await supabase.auth.signOut();
});

describe('the catalog being down (1.4)', () => {
  it('a failed item search says so on the screen, and a new search recovers', async () => {
    const user = userEvent.setup();
    const token = await auctioneerToken();
    const real = globalThis.fetch;
    let down = true;
    // While the catalog is down, only the search fails with the API's own catalog_unavailable answer.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      down && urlOf(input).includes('/api/catalog/search')
        ? Promise.resolve(failing('O catálogo de itens está indisponível. Tente de novo em instantes.', 503, 'catalog_unavailable'))
        : real(input, init),
    );
    render(<CatalogSearch token={token} onPick={() => {}} />);

    await user.type(screen.getByLabelText('Buscar item no acervo'), 'vase');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O catálogo de itens está indisponível. Tente de novo em instantes.');

    down = false;
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    // Recovery means the real results are on the screen, not only that the alert is gone: the alert also goes away
    // for a moment while the new search is loading.
    expect((await screen.findAllByRole('button', { name: 'Usar este item' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the showcase error state (2.5)', () => {
  it('a failed list shows the error with a retry, and the retry shows the list again', async () => {
    const user = userEvent.setup();
    const real = globalThis.fetch;
    let down = true;
    // While the list is down, every lot list request fails; the real API answers again after that.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      down && urlOf(input).includes('/api/lots?')
        ? Promise.resolve(failing('Não foi possível carregar os lotes.', 500, 'internal_error'))
        : real(input, init),
    );
    render(<MemoryRouter><Showcase /></MemoryRouter>);

    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar os lotes.');
    down = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    // The list is back when it shows a card or the empty hint; the alert alone also goes away while it loads.
    await waitFor(() => {
      expect(screen.queryAllByRole('article').length > 0 || screen.queryByText(/Nenhum lote ao vivo agora/) !== null).toBe(true);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the catalog search pages through the whole collection (B24)', () => {
  it('shows the total and goes to the next page of results, then back', async () => {
    const user = userEvent.setup();
    const token = await auctioneerToken();
    render(<CatalogSearch token={token} onPick={() => {}} />);

    await user.type(screen.getByLabelText('Buscar item no acervo'), 'vase');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/9\.229 resultados/)).toBeTruthy();
    expect(screen.getByText(/Página 1 de 770/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(await screen.findByText(/Página 2 de 770/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(await screen.findByText(/Página 1 de 770/)).toBeTruthy();
  });

  it('says the Met shows only its first 10,000 results when the search has more', async () => {
    const user = userEvent.setup();
    const token = await auctioneerToken();
    render(<CatalogSearch token={token} onPick={() => {}} />);

    await user.type(screen.getByLabelText('Buscar item no acervo'), 'painting');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/61\.230 resultados/)).toBeTruthy();
    expect(screen.getByText(/só os primeiros 10\.000 resultados/)).toBeTruthy();
  });
});
