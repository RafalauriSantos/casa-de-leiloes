import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, storedTheme } from '@/lib/theme';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('the theme switch (B21, 9.3)', () => {
  it('switches to dark and back, and the choice survives a reload', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Usar tema escuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    // A reload: the page starts over and applies the stored choice before it renders, as main.tsx does.
    cleanup();
    delete document.documentElement.dataset.theme;
    applyTheme(storedTheme());
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Usar tema claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
