import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import { DEMO_ACCOUNTS } from '@casa/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';
import { AuthPanel } from './index';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/app/App';
import { signInFailure } from './api';
import { safeNext } from './next';

// Real Supabase Auth of the local stack (make db-up): no mocks.
afterEach(async () => {
  cleanup();
  await supabase.auth.signOut();
});

describe('AuthPanel', () => {
  it('shows one generic message for a wrong login', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthPanel /></MemoryRouter>);

    await user.type(screen.getByLabelText('E-mail'), `nobody-${randomUUID()}@example.test`);
    await user.type(screen.getByLabelText('Senha'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('E-mail ou senha incorretos.');
    // The fields name their error, so a screen reader reads the message with the field it belongs to.
    for (const label of ['E-mail', 'Senha']) {
      const field = screen.getByLabelText(label);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe(alert.id);
    }
  });

  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'E-mail ou senha incorretos.'],
    [{ code: 'email_not_confirmed', status: 400 }, 'Confirme o e-mail que enviamos antes de entrar.'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'Muitas tentativas. Tente de novo em alguns minutos.'],
    [{ status: 500 }, 'Não foi possível entrar agora. Tente de novo em instantes.'],
    [{ status: undefined }, 'Não foi possível entrar agora. Tente de novo em instantes.'],
  ])('says why a sign-in failed: %j', (error, message) => {
    expect(signInFailure(error)).toEqual({ ok: false, message });
  });

  it.each([
    ['/carteira', '/carteira'],
    ['/lotes/abc?x=1', '/lotes/abc?x=1'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    [null, '/'],
  ])('returns to the page asked for only when it is a path of this app: %s', (value, path) => {
    expect(safeNext(value)).toBe(path);
  });

  it('offers the demo accounts, and a shortcut is a real sign-in (0.8)', async () => {
    // The seed creates this account; make sure it exists when this file runs alone (a second sign-up is refused, harmlessly).
    await supabase.auth.signUp({ email: DEMO_ACCOUNTS.auctioneer, password: DEMO_ACCOUNTS.password, options: { data: { role: 'auctioneer' } } });
    await supabase.auth.signOut();
    const user = userEvent.setup();
    render(<MemoryRouter><AuthPanel /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Entrar como leiloeiro (demo)' }));

    await waitFor(async () => {
      const { data } = await supabase.auth.getSession();
      expect(data.session?.user.email).toBe(DEMO_ACCOUNTS.auctioneer);
    });
  });

  it('creates a real account and opens a session', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthPanel /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Não tenho conta' }));
    await user.type(screen.getByLabelText('Nome'), 'Teste Front');
    await user.type(screen.getByLabelText('E-mail'), `f-${randomUUID()}@example.test`);
    await user.type(screen.getByLabelText('Senha'), randomBytes(12).toString('hex'));
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(async () => {
      const { data } = await supabase.auth.getSession();
      expect(data.session?.user.id).toBeTruthy();
    });
  });

  it('brings a person back to the page they asked for after sign-in', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/carteira');
    render(<App />);
    await waitFor(() => { expect(window.location.pathname).toBe('/entrar'); });

    await user.click(await screen.findByRole('button', { name: 'Entrar como licitante 1 (demo)' }));
    await waitFor(() => { expect(window.location.pathname).toBe('/carteira'); });
  });
});
