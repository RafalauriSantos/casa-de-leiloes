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

async function promoteToAuctioneer(userId: string): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("update public.profiles set role = 'auctioneer' where id = $1", [userId]);
  } finally {
    await client.end();
  }
}

describe('bidder journey', () => {
  it('signs up, sees an empty wallet, deposits once even on a double click, signs out and back in', async () => {
    const user = userEvent.setup();
    const { email, password } = credentials();
    render(<App />);

    // Sign up
    await user.click(await screen.findByRole('link', { name: 'Entre ou crie sua conta' }));
    await user.click(screen.getByRole('button', { name: 'Não tenho conta' }));
    await user.type(screen.getByLabelText('Nome'), 'Ana Jornada');
    await user.type(screen.getByLabelText('E-mail'), email);
    await user.type(screen.getByLabelText('Senha'), password);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Ana Jornada')).toBeTruthy();

    // Empty wallet
    await user.click(screen.getByRole('link', { name: 'Carteira' }));
    expect(await screen.findByRole('heading', { name: 'Carteira' })).toBeTruthy();
    await waitFor(() => { expect(screen.getAllByText('R$ 0,00')).toHaveLength(3); });

    // Deposit
    await user.type(screen.getByLabelText('Valor (R$)'), '250,00');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    expect((await screen.findByRole('status')).textContent).toBe('Depósito de R$ 250,00 realizado.');
    const summary = screen.getByLabelText('Saldos');
    expect(within(summary).getAllByText('R$ 250,00')).toHaveLength(2);

    // Double click credits once
    await user.type(screen.getByLabelText('Valor (R$)'), '100,00');
    await user.dblClick(screen.getByRole('button', { name: 'Depositar' }));
    await waitFor(() => { expect(within(screen.getByLabelText('Saldos')).getAllByText('R$ 350,00')).toHaveLength(2); });

    // Sign out: the wallet is closed and the login is offered
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Carteira' })).toBeNull();

    // A wrong password gives one generic message
    await user.click(screen.getByRole('link', { name: 'Entrar' }));
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

  it('keeps the form usable and shows the API reason when the deposit is refused', async () => {
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
  it('has no wallet: no menu entry and the wallet screen explains it is for bidders', async () => {
    const { email, password } = credentials();
    const { data } = await supabase.auth.signUp({ email, password });
    if (!data.user) throw new Error('sign-up did not return a user');
    await promoteToAuctioneer(data.user.id);

    window.history.replaceState({}, '', '/carteira');
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe('Esta área é exclusiva para licitantes.');
    expect(screen.queryByRole('link', { name: 'Carteira' })).toBeNull();
  });
});

describe('visitor', () => {
  it('is sent to the login from the wallet and sees the not-found page for unknown routes', async () => {
    window.history.replaceState({}, '', '/carteira');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    unmount();

    window.history.replaceState({}, '', '/nao-existe');
    render(<App />);
    expect(await screen.findByText('Página não encontrada.')).toBeTruthy();
  });
});
