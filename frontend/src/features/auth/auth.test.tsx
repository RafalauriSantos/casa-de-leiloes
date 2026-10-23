import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';
import { AuthPanel } from './index';

// Real Supabase Auth of the local stack (make db-up): no mocks.
afterEach(async () => {
  cleanup();
  await supabase.auth.signOut();
});

describe('AuthPanel', () => {
  it('shows one generic message for a wrong login', async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);

    await user.type(screen.getByLabelText('E-mail'), `nobody-${randomUUID()}@example.test`);
    await user.type(screen.getByLabelText('Senha'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha incorretos.');
  });

  it('creates a real account and opens a session', async () => {
    const user = userEvent.setup();
    render(<AuthPanel />);

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
});
