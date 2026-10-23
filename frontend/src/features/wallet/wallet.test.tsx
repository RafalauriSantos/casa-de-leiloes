import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '@/features/auth';
import { WalletPage } from '@/pages/wallet';
import { DepositForm } from './components/DepositForm';
import { WalletSummary } from './components/WalletSummary';

afterEach(cleanup);

describe('DepositForm validation (refuses before any request is made)', () => {
  // The token is a placeholder: every case below is refused locally, so no request is sent.
  const setup = () => {
    render(<DepositForm token="unused" onDeposited={() => { throw new Error('must not deposit'); }} />);
    return userEvent.setup();
  };

  it.each(['abc', '1,234', '-5', '0,001'])('refuses %s as not an amount', async (typed) => {
    const user = setup();
    await user.type(screen.getByLabelText('Valor (R$)'), typed);
    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Informe um valor válido, por exemplo 250,00.');
  });

  it.each(['0,50', '100.000,01'])('refuses %s as outside the limits and says the limits', async (typed) => {
    const user = setup();
    await user.type(screen.getByLabelText('Valor (R$)'), typed);
    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O depósito deve ser de R$ 1,00 a R$ 100.000,00.');
  });
});

describe('WalletSummary', () => {
  it('shows total, committed and available in reais', () => {
    render(<WalletSummary wallet={{ totalCents: 150_000, committedCents: 40_000, availableCents: 110_000 }} />);
    expect(screen.getByText('R$ 1.500,00')).toBeTruthy();
    expect(screen.getByText('R$ 400,00')).toBeTruthy();
    expect(screen.getByText('R$ 1.100,00')).toBeTruthy();
  });
});

describe('screen guard (real Supabase Auth, no session)', () => {
  it('sends a signed-out visitor from /carteira to the login and never shows the wallet', async () => {
    render(
      <MemoryRouter initialEntries={['/carteira']}>
        <AuthProvider>
          <Routes>
            <Route path="/carteira" element={<WalletPage />} />
            <Route path="/entrar" element={<p>Tela de login</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Tela de login')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Carteira' })).toBeNull();
  });
});
