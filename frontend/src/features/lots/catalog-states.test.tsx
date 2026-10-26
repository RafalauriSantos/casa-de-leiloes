import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
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

async function signedInToken(): Promise<string> {
  const email = `cat-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const { error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) throw new Error(`sign-up failed: ${signUpError.message}`);
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
    const token = await signedInToken();
    const real = globalThis.fetch;
    let down = true;
    // While the catalog is down, only the search fails with the API's own catalog_unavailable answer.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      down && urlOf(input).includes('/api/catalog/search')
        ? Promise.resolve(failing('O catálogo de itens está indisponível. Tente de novo em instantes.', 503, 'catalog_unavailable'))
        : real(input, init),
    );
    render(<CatalogSearch token={token} onPick={() => {}} />);

    await user.type(screen.getByLabelText('Palavra-chave'), 'vaso');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O catálogo de itens está indisponível. Tente de novo em instantes.');

    down = false;
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull(); });
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
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull(); });
    expect(screen.getByRole('button', { name: 'Ao vivo' })).toBeTruthy();
  });
});
