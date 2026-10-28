import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { supabase } from '@/lib/supabase';
import { toLocalField } from './time';

// Auctioneer and showcase journeys: real UI, real API, real Postgres and Auth, catalog from captured responses.
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

/** Everything the screen announces, joined: the panel has more than one status line. */
const notices = () => screen.queryAllByRole('status').map((node) => node.textContent).join(' | ');

/** A new auctioneer signed in on this browser, as the seed will make them. */
async function signedInAuctioneer(): Promise<string> {
  const email = `a-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) throw new Error(`sign-up failed: ${error?.message ?? 'no user'}`);
  await sql("update public.profiles set role = 'auctioneer' where id = $1", [data.user.id]);
  // Sign in again so the app reads the new role from /api/me.
  await supabase.auth.signOut();
  const login = await supabase.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(`sign-in failed: ${login.error.message}`);
  return data.user.id;
}

const inMinutes = (minutes: number) => toLocalField(new Date(Date.now() + minutes * 60_000).toISOString());

describe('auctioneer journey: find an item, publish, edit, cancel', () => {
  it('publishes a lot from a catalog item and manages it', async () => {
    const user = userEvent.setup();
    const marker = `Vaso${randomUUID().slice(0, 6)}`;
    await signedInAuctioneer();
    window.history.replaceState({}, '', '/leiloeiro');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Painel do leiloeiro' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Novo lote' }));

    // Step 1: the catalog is never an empty box: it opens with shortcuts, and one tap lists items
    await user.click(await screen.findByRole('button', { name: 'Vaso' }));
    const pick = await screen.findAllByRole('button', { name: 'Usar este item' });
    expect(pick.length).toBeGreaterThanOrEqual(5);
    const [first] = pick;
    if (!first) throw new Error('the catalog search returned no item to pick');
    await user.click(first);

    // Step 2: the data, with the dates and the values already filled
    const form = screen.getByRole('form', { name: 'Dados do lote' });
    expect(within(form).getByLabelText<HTMLInputElement>('Lance inicial (R$)').value).toBe('500,00');
    expect(within(form).getByLabelText<HTMLInputElement>('Início (horário de Brasília)').value).not.toBe('');
    const title = within(form).getByLabelText<HTMLInputElement>('Título');
    await user.clear(title);
    await user.type(title, marker);
    fireEvent.change(within(form).getByLabelText('Início (horário de Brasília)'), { target: { value: inMinutes(60) } });
    fireEvent.change(within(form).getByLabelText('Fim (horário de Brasília)'), { target: { value: inMinutes(180) } });
    await user.click(within(form).getByRole('button', { name: 'Continuar' }));

    // Step 3: the summary, then publish
    expect(screen.getByText(marker, { selector: 'strong' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Publicar lote' }));

    await waitFor(() => { expect(notices()).toContain('publicado'); });
    const card = await screen.findByRole('heading', { name: marker, level: 3 });
    const lot = card.closest('article');
    if (!lot) throw new Error('the lot card is not inside an article');
    expect(within(lot).getByText('Agendado')).toBeTruthy();
    expect(within(lot).getByText(/Cancelar lote/)).toBeTruthy();

    // Edit before it starts: the change is saved and shown.
    await user.click(within(lot).getByRole('button', { name: 'Editar' }));
    const editForm = within(lot).getByRole('form', { name: 'Salvar alterações' });
    const editTitle = within(editForm).getByLabelText<HTMLInputElement>('Título');
    await user.clear(editTitle);
    await user.type(editTitle, `${marker} editado`);
    await user.click(within(editForm).getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByRole('heading', { name: `${marker} editado`, level: 3 })).toBeTruthy();

    // Cancel with no bids asks first; once confirmed, the lot is gone from the owner's list as a cancelled lot.
    const edited = (await screen.findByRole('heading', { name: `${marker} editado`, level: 3 })).closest('article');
    if (!edited) throw new Error('the edited lot is not inside a card');
    await user.click(within(edited).getByRole('button', { name: 'Cancelar lote' }));
    expect(within(edited).getByRole('button', { name: 'Confirmar cancelamento' })).toBeTruthy();
    expect(notices()).not.toContain('cancelado');
    await user.click(within(edited).getByRole('button', { name: 'Confirmar cancelamento' }));
    await waitFor(() => { expect(notices()).toContain('cancelado'); });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Cancelar lote/ })).toBeNull();
    });
  });

  it('says so when a search finds nothing with a public image', async () => {
    const user = userEvent.setup();
    await signedInAuctioneer();
    window.history.replaceState({}, '', '/leiloeiro/novo');
    render(<App />);
    await user.type(await screen.findByLabelText('Buscar item no acervo'), 'nada-disto-existe');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Nenhum item com imagem pública para essa busca.')).toBeTruthy();
  });

  it('refuses inverted times with the reason, and keeps the form for a corrected retry', async () => {
    const user = userEvent.setup();
    await signedInAuctioneer();
    window.history.replaceState({}, '', '/leiloeiro/novo');
    render(<App />);
    await user.type(await screen.findByLabelText('Buscar item no acervo'), 'vase');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const [first] = await screen.findAllByRole('button', { name: 'Usar este item' });
    if (!first) throw new Error('the catalog search returned no item to pick');
    await user.click(first);
    const form = screen.getByRole('form', { name: 'Dados do lote' });
    fireEvent.change(within(form).getByLabelText('Início (horário de Brasília)'), { target: { value: inMinutes(180) } });
    fireEvent.change(within(form).getByLabelText('Fim (horário de Brasília)'), { target: { value: inMinutes(60) } });
    await user.click(within(form).getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Publicar lote' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O fim do lote precisa ser depois do início.');
    // The data is kept: going back shows the same dates, ready for a corrected retry
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    // The refusal stays on the screen it sends the person back to, and the new step's heading takes the focus
    expect(screen.getByRole('alert').textContent).toBe('O fim do lote precisa ser depois do início.');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sobre o item' }));
    expect(within(screen.getByRole('form', { name: 'Dados do lote' })).getByLabelText<HTMLInputElement>('Início (horário de Brasília)').value).toBe(inMinutes(180));
  });
});

describe('showcase and lot page (no login needed)', () => {
  it('lists a published lot under its state and opens its page with the item\'s facts', async () => {
    const user = userEvent.setup();
    await signedInAuctioneer();
    const marker = `Jarra${randomUUID().slice(0, 6)}`;
    window.history.replaceState({}, '', '/leiloeiro/novo');
    const { unmount } = render(<App />);
    await user.type(await screen.findByLabelText('Buscar item no acervo'), 'vase');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const [first] = await screen.findAllByRole('button', { name: 'Usar este item' });
    if (!first) throw new Error('the catalog search returned no item to pick');
    await user.click(first);
    const form = screen.getByRole('form', { name: 'Dados do lote' });
    await user.clear(within(form).getByLabelText('Título'));
    await user.type(within(form).getByLabelText('Título'), marker);
    fireEvent.change(within(form).getByLabelText('Início (horário de Brasília)'), { target: { value: inMinutes(60) } });
    fireEvent.change(within(form).getByLabelText('Fim (horário de Brasília)'), { target: { value: inMinutes(180) } });
    fireEvent.change(within(form).getByLabelText('Lance inicial (R$)'), { target: { value: '1.234,56' } });
    fireEvent.change(within(form).getByLabelText('Incremento mínimo (R$)'), { target: { value: '100,00' } });
    await user.click(within(form).getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Publicar lote' }));
    await waitFor(() => { expect(notices()).toContain('publicado'); });
    unmount();
    await supabase.auth.signOut();

    // Anyone, not signed in: the showcase, on the scheduled tab.
    window.history.replaceState({}, '', '/');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Agendados' }));
    const search = screen.getByRole('search');
    await user.type(within(search).getByLabelText('Buscar por título'), marker);
    await user.click(within(search).getByRole('button', { name: 'Buscar' }));
    const link = await screen.findByRole('link', { name: new RegExp(marker) });
    const card = link.closest('article');
    if (!card) throw new Error('the lot link is not inside a card');
    expect(within(card).getByText('R$ 1.234,56')).toBeTruthy();

    await user.click(link);
    expect(await screen.findByRole('heading', { name: marker })).toBeTruthy();
    expect(screen.getByText('Ver a obra na fonte (The Met)')).toBeTruthy();
    expect(screen.getByText('Soft-paste porcelain')).toBeTruthy();
  });

  it('shows the showcase loading and an empty state for a tab with nothing in it', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Encerrados' }));
    await waitFor(() => {
      expect(screen.queryByText('Carregando lotes…')).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'Leilões ao vivo' })).toBeTruthy();
  });

  it('offers the next step on an empty list: the visitor sees the scheduled lots, the auctioneer creates one', async () => {
    const user = userEvent.setup();
    const nothing = `sem-lote-${randomUUID().slice(0, 8)}`;
    const searchFor = async () => {
      const search = await screen.findByRole('search');
      await user.type(within(search).getByLabelText('Buscar por título'), nothing);
      await user.click(within(search).getByRole('button', { name: 'Buscar' }));
      await screen.findByText(new RegExp(`Nenhum lote encontrado para "${nothing}"`));
    };
    window.history.replaceState({}, '', '/');
    const visitor = render(<App />);
    await searchFor();
    expect(screen.queryByRole('link', { name: 'Criar lote' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ver agendados' }));
    expect(screen.getByRole('button', { name: 'Agendados' }).getAttribute('aria-pressed')).toBe('true');
    visitor.unmount();

    await signedInAuctioneer();
    window.history.replaceState({}, '', '/');
    render(<App />);
    await searchFor();
    expect(screen.getByRole('link', { name: 'Criar lote' }).getAttribute('href')).toBe('/leiloeiro/novo');
    expect(screen.queryByRole('button', { name: 'Ver agendados' })).toBeNull();
  });

  it('answers a missing lot with a message, not a blank page', async () => {
    window.history.replaceState({}, '', `/lotes/${randomUUID()}`);
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('bidders do not see the auctioneer panel', () => {
  it('shows the role message to a bidder who opens it', async () => {
    const { data } = await supabase.auth.signUp({ email: `b-${randomUUID()}@example.test`, password: randomBytes(12).toString('hex') });
    expect(data.user).toBeTruthy();
    window.history.replaceState({}, '', '/leiloeiro');
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('Esta área é exclusiva para leiloeiros.');
  });
});
