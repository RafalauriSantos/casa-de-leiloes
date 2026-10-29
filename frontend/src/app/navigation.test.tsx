import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

// B36, criteria 8.6: titles, the not-found page, and focus after navigation (real router, signed out).
describe('screens: title, heading and focus (B36, 8.6)', () => {
  it('every screen sets its own document title, with the app name', async () => {
    window.history.replaceState({}, '', '/carteira');
    render(<App />);
    await waitFor(() => { expect(document.title).toBe('Carteira · Casa de Leilões'); });

    cleanup();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await waitFor(() => { expect(document.title).toBe('Leilões ao vivo · Casa de Leilões'); });
  });

  it('the not-found page has a heading, a link back to the lots and its own title', async () => {
    window.history.replaceState({}, '', '/nao-existe');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeTruthy();
    // The header has its own link with the same name; the page's link is the one inside <main>.
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Voltar aos lotes' }).getAttribute('href')).toBe('/');
    expect(document.title).toBe('Página não encontrada · Casa de Leilões');
  });

  it('after a move to another screen, focus goes to its heading; on the first load it is not moved', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Leilões ao vivo' });
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1, name: 'Leilões ao vivo' }));

    cleanup();
    window.history.replaceState({}, '', '/nao-existe');
    render(<App />);
    await user.click(within(await screen.findByRole('main')).getByRole('link', { name: 'Voltar aos lotes' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Leilões ao vivo' }));
    });
  });

  it('going back to the first screen the app opened moves focus to its heading again', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Leilões ao vivo' });
    await user.click(screen.getByRole('link', { name: 'Entrar' }));
    await screen.findByRole('button', { name: 'Entrar' });
    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Voltar aos lotes' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Leilões ao vivo' }));
    });
  });

  it('a screen with no heading yet gets focus on its main region, and moves it to the heading when one appears', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Leilões ao vivo' });
    await user.click(screen.getByRole('link', { name: 'Entrar' }));
    await screen.findByRole('button', { name: 'Entrar' });
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('main')); });
  });

  it('a lot page with its title loaded later takes focus once the heading appears', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/');
    render(<App />);
    const featured = await screen.findByRole('region', { name: 'Lote ao vivo em destaque' });
    await user.click(within(featured).getByRole('link', { name: 'Dar lance' }));
    const title = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => { expect(document.activeElement).toBe(title); });
  });
});
