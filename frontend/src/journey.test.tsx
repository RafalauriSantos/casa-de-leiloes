import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { supabase } from '@/lib/supabase';

// The whole product flow through the real UI, real Supabase Auth, real API and real Postgres.
const credentials = () => ({ email: `j-${randomUUID()}@example.test`, password: randomBytes(12).toString('hex') });

afterEach(async () => {
  cleanup();
  await supabase.auth.signOut();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

const promoteToAuctioneer = (userId: string) => sql("update public.profiles set role = 'auctioneer' where id = $1", [userId]);

describe('bidder journey', () => {
  it('signs up, sees an empty wallet, deposits once even on a double click, signs out and back in', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    render(<App />);

    // Sign up
    await user.click(await screen.findByRole('link', { name: 'Entrar' }));
    await user.click(screen.getByRole('button', { name: 'Não tenho conta' }));
    await user.type(screen.getByLabelText('Nome'), 'Ana Jornada');
    await user.type(screen.getByLabelText('E-mail'), email);
    await user.type(screen.getByLabelText('Senha'), password);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Ana Jornada')).toBeTruthy();

    // Empty wallet
    await user.click(screen.getByRole('link', { name: 'Carteira' }));
    expect(await screen.findByRole('heading', { name: 'Carteira' })).toBeTruthy();
    await waitFor(() => { expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 0,00')).toHaveLength(3); });

    // Deposit
    await user.type(screen.getByLabelText('Valor (R$)'), '250,00');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    expect((await screen.findByRole('status')).textContent).toBe('Depósito de R$ 250,00 realizado.');
    // The balance in the header follows the deposit without a reload
    await waitFor(() => { expect(screen.getByRole('link', { name: /Saldo/ }).textContent).toContain('R$ 250,00'); });
    const summary = screen.getByLabelText('Saldos');
    expect(within(summary).getAllByText('R$ 250,00')).toHaveLength(2);

    // Double click credits once
    await user.type(screen.getByLabelText('Valor (R$)'), '100,00');
    await user.dblClick(screen.getByRole('button', { name: 'Depositar' }));
    await waitFor(() => { expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 350,00')).toHaveLength(2); });

    // The account menu names the account and its role, offers the bidder's places, and closes with Escape
    // The balance reaches the header only after the wallet loads; wait for it, so the menu is open with the balance known.
    await screen.findByText('Saldo');
    await user.click(screen.getByRole('button', { expanded: false }));
    const menu = screen.getByRole('dialog', { name: 'Menu da conta' });
    expect(within(menu).getByText('Conta de licitante', { exact: false })).toBeTruthy();
    // The balance is in the header; the menu names the role only (B43).
    expect(within(menu).queryByText(/saldo/i)).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Meus arremates' })).toBeTruthy();
    await user.tab();
    expect(menu.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Menu da conta' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { expanded: false }));

    // Sign out: the wallet is closed and the login is offered
    await user.click(screen.getByRole('button', { expanded: false }));
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Acesse sua conta' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Carteira' })).toBeNull();

    // A wrong password gives one generic message
    await user.type(screen.getByLabelText('E-mail'), email);
    await user.type(screen.getByLabelText('Senha'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha incorretos.');

    // The right password brings the balance back
    await user.clear(screen.getByLabelText('Senha'));
    await user.type(screen.getByLabelText('Senha'), password);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Ana Jornada')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Carteira' }));
    await waitFor(() => { expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 350,00')).toHaveLength(2); });
  });

  it('refuses a deposit below the minimum before any request and keeps the form usable', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    await supabase.auth.signUp({ email, password });
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Carteira' }));
    await user.type(await screen.findByLabelText('Valor (R$)'), '0,50');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O depósito deve ser de R$ 1,00 a R$ 100.000,00.');
    expect(screen.getByRole('button', { name: 'Depositar' }).hasAttribute('disabled')).toBe(false);
  });
});

describe('auctioneer access', () => {
  it('signs up choosing "Quero vender" and gets the auctioneer panel, not a wallet (0.6)', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Entrar' }));
    await user.click(screen.getByRole('button', { name: 'Não tenho conta' }));
    await user.type(screen.getByLabelText('Nome'), 'Vera Vendedora');
    await user.click(screen.getByRole('radio', { name: 'Quero vender' }));
    await user.type(screen.getByLabelText('E-mail'), email);
    await user.type(screen.getByLabelText('Senha'), password);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    // After sign-in the auctioneer lands on the panel, with its own navigation and no wallet
    expect(await screen.findByRole('heading', { name: 'Painel do leiloeiro' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Painel' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Carteira' })).toBeNull();
  });

  it('has no wallet: no menu entry and the wallet screen explains it is for bidders', async () => {
    const { email, password } = credentials();
    const { data } = await supabase.auth.signUp({ email, password });
    if (!data.user) throw new Error('sign-up did not return a user');
    await promoteToAuctioneer(data.user.id);

    window.history.replaceState({}, '', '/carteira');
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe('Esta área é exclusiva para licitantes.');
    expect(screen.getByRole('link', { name: 'Ir para o painel' }).getAttribute('href')).toBe('/leiloeiro');
    expect(screen.queryByRole('link', { name: 'Carteira' })).toBeNull();
  });
});

describe('visitor', () => {
  it('has a way back to the storefront on every screen but the storefront itself', async () => {
    window.history.replaceState({}, '', '/comprovante/abc');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('link', { name: 'Voltar aos lotes' })).toBeTruthy();
    unmount();

    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Voltar aos lotes' })).toBeNull();
  });

  it('is sent to the login from the wallet and sees the not-found page for unknown routes', async () => {
    window.history.replaceState({}, '', '/carteira');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Acesse sua conta' })).toBeTruthy();
    unmount();

    window.history.replaceState({}, '', '/nao-existe');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeTruthy();
  });
});

describe('when the API refuses or fails (the reason is shown and the user is never stuck)', () => {
  it('shows the API message and a retry when the wallet cannot be read, then recovers', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    const { data } = await supabase.auth.signUp({ email, password });
    if (!data.user) throw new Error('sign-up did not return a user');
    await sql('delete from public.wallets where user_id = $1', [data.user.id]);

    window.history.replaceState({}, '', '/carteira');
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('Carteira não encontrada.');

    await sql('insert into public.wallets (user_id) values ($1)', [data.user.id]);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => { expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 0,00').length).toBeGreaterThan(0); });
  });

  it('offers to sign out when the account cannot be loaded', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    const { data } = await supabase.auth.signUp({ email, password });
    if (!data.user) throw new Error('sign-up did not return a user');
    await sql('delete from public.profiles where id = $1', [data.user.id]);

    window.history.replaceState({}, '', '/carteira');
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('Perfil não encontrado para este usuário.');
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy();
  });
});

describe('keeping the screen steady (review findings)', () => {
  it('keeps the typed amount when the session token is refreshed in the background', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    await supabase.auth.signUp({ email, password });
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Carteira' }));
    const input = await screen.findByLabelText('Valor (R$)');
    await user.type(input, '123,45');

    // A real token refresh makes Supabase emit a new session for the same user.
    const { error } = await supabase.auth.refreshSession();
    expect(error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(screen.getByLabelText<HTMLInputElement>('Valor (R$)').value).toBe('123,45');
    expect(screen.getByRole('heading', { name: 'Carteira' })).toBeTruthy();
  });

  it('does not let a slow, older balance read overwrite a deposit that finished first', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    await supabase.auth.signUp({ email, password });

    // The real API answers the first wallet read at once, but its delivery is held back so it
    // arrives after the deposit: the stale-read ordering from the review.
    const realFetch = globalThis.fetch;
    let held = false;
    globalThis.fetch = async (input, init) => {
      const response = await realFetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!held && url.endsWith('/api/wallet') && (init?.method ?? 'GET') === 'GET') {
        held = true;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return response;
    };

    try {
      window.history.replaceState({}, '', '/carteira');
      render(<App />);
      await user.type(await screen.findByLabelText('Valor (R$)'), '100,00');
      await user.click(screen.getByRole('button', { name: 'Depositar' }));
      await waitFor(() => { expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 100,00')).toHaveLength(2); });

      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 100,00')).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('a deposit whose response was lost', () => {
  it('can be retried with the same amount and is credited exactly once', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    await supabase.auth.signUp({ email, password });

    // The real API commits the deposit, but the answer never reaches the browser: the case the
    // idempotency key exists for.
    const realFetch = globalThis.fetch;
    let lost = false;
    globalThis.fetch = async (input, init) => {
      const response = await realFetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!lost && url.endsWith('/api/wallet/deposits') && init?.method === 'POST') {
        lost = true;
        throw new TypeError('connection lost after the server answered');
      }
      return response;
    };

    try {
      window.history.replaceState({}, '', '/carteira');
      render(<App />);
      await user.type(await screen.findByLabelText('Valor (R$)'), '80,00');
      await user.click(screen.getByRole('button', { name: 'Depositar' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Sem conexão/);

      // The amount is still there: retry it as is.
      await user.click(screen.getByRole('button', { name: 'Depositar' }));
      expect((await screen.findByRole('status')).textContent).toBe('Depósito de R$ 80,00 realizado.');
      expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 80,00')).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }

    // And the server agrees: one deposit, not two.
    const { data } = await supabase.auth.getSession();
    const wallet = await realFetch('/api/wallet', { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
    expect(((await wallet.json()) as { totalCents: number }).totalCents).toBe(8_000);
  });
});
