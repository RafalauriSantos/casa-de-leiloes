import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { supabase } from '@/lib/supabase';

// The live room, end to end in the UI: real API, real Postgres and Auth, catalog from captured responses.
afterEach(async () => {
  cleanup();
  await supabase.auth.signOut();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

const API = process.env.VITE_SUPABASE_URL ?? '';

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

interface Account {
  id: string;
  token: string;
  email: string;
  password: string;
}

/** Credentials of every account this file creates, so the app can sign in as any of them. */
const accounts = new Map<string, Account>();

/** A new account through the real Auth API. Its token drives the API calls; the app signs in with the same credentials. */
async function newAccount(role?: 'auctioneer'): Promise<Account> {
  const email = `r-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token: string; user: { id: string } };
  if (role) await sql('update public.profiles set role = $2 where id = $1', [body.user.id, role]);
  const account = { id: body.user.id, token: body.access_token, email, password };
  accounts.set(account.id, account);
  return account;
}

async function api(path: string, token: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<Response> {
  return fetch(`${window.location.origin}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.key ? { 'Idempotency-Key': init.key } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function liveLotFor(auctioneerToken: string): Promise<string> {
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const created = await api('/api/lots', auctioneerToken, {
    method: 'POST',
    body: { externalId: '205482', title: `Vaso da sala ${randomUUID().slice(0, 6)}`, startsAt: later, endsAt: new Date(Date.now() + 7_200_000).toISOString(), startingBidCents: 50_000, incrementCents: 5_000 },
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as { id: string };
  await sql("update public.lots set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour' where id = $1", [lot.id]);
  return lot.id;
}

async function fundedBidder(cents: number): Promise<Account> {
  const bidder = await newAccount();
  const deposit = await api('/api/wallet/deposits', bidder.token, { method: 'POST', body: { amountCents: cents }, key: randomUUID() });
  expect(deposit.status).toBe(201);
  return bidder;
}

describe('live room: bidding in the UI', () => {
  it('a bidder leads, and the room tells them without a reload when someone else outbids them', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const ana = await fundedBidder(1_000_000);
    const bruno = await fundedBidder(1_000_000);

    // Ana signs in through the app.
    await signInAs(ana.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    expect(await screen.findByRole('region', { name: 'Sala do lote' })).toBeTruthy();
    const room = screen.getByRole('region', { name: 'Sala do lote' });
    expect(within(room).getByText('Ao vivo')).toBeTruthy();
    expect(within(room).getByText('R$ 500,00')).toBeTruthy();

    const form = screen.getByRole('form', { name: 'Dar lance' });
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    expect(await screen.findByText('Você está ganhando.')).toBeTruthy();

    // Bruno outbids her through the API; her screen catches up on its own (polling every 3 s).
    const outbid = await api(`/api/lots/${lotId}/bids`, bruno.token, { method: 'POST', body: { amountCents: 55_000 } });
    expect(outbid.status).toBe(201);
    expect(await screen.findByText('Você foi superado.', undefined, { timeout: 8_000 })).toBeTruthy();
    // The current bid is shown in the room (and again in the history), and the bid field and button advance to the new minimum.
    expect(within(room).getByText('Lance atual').closest('div')?.textContent).toContain('R$ 550,00');
    expect(within(form).getByLabelText<HTMLInputElement>('Seu lance (R$)').value).toBe('600,00');
    expect(within(form).getByRole('button', { name: 'Dar lance de R$ 600,00' })).toBeTruthy();
    expect(within(room).getAllByText('Você').length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('a refused bid shows the exact reason, links to the wallet when funds are short, and keeps the amount typed', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const carla = await fundedBidder(10_000);
    await signInAs(carla.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Dar lance' });
    const input = within(form).getByLabelText<HTMLInputElement>('Seu lance (R$)');
    fireEvent.change(input, { target: { value: '500,00' } });
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    expect((await within(form).findByRole('alert')).textContent).toBe('Saldo disponível insuficiente: você tem R$ 100,00 para lances.');
    expect(within(form).getByRole('link', { name: 'Depositar na carteira' }).getAttribute('href')).toBe('/carteira');
    expect(input.value).toBe('500,00');
  });

  it('a refused bid message goes away as soon as the bidder changes the amount', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const carla = await fundedBidder(10_000);
    await signInAs(carla.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Dar lance' });
    const input = within(form).getByLabelText<HTMLInputElement>('Seu lance (R$)');
    fireEvent.change(input, { target: { value: '500,00' } });
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    await within(form).findByRole('alert');
    fireEvent.change(input, { target: { value: '90,00' } });
    expect(within(form).queryByRole('alert')).toBeNull();
  });

  it('the minimum-bid shortcut also clears a refused bid message', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const carla = await fundedBidder(10_000);
    await signInAs(carla.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    const form = await screen.findByRole('form', { name: 'Dar lance' });
    const input = within(form).getByLabelText<HTMLInputElement>('Seu lance (R$)');
    fireEvent.change(input, { target: { value: '500,00' } });
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    await within(form).findByRole('alert');
    await user.click(within(form).getByRole('button', { name: 'Usar lance mínimo' }));
    expect(within(form).queryByRole('alert')).toBeNull();
  });

  it('a visitor sees the room without a bid form and is asked to sign in', async () => {
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    expect(await screen.findByText('Entre como licitante para dar lances.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Dar lance' })).toBeNull();
  });

  it('tells a bidder why a lot takes no bid yet or any more: not started or ended', async () => {
    const auctioneer = await newAccount('auctioneer');
    const bidder = await newAccount();
    await signInAs(bidder.id);
    const later = (ms: number) => new Date(Date.now() + ms).toISOString();
    const created = await api('/api/lots', auctioneer.token, {
      method: 'POST',
      body: { externalId: '205482', title: `Sem lance ${randomUUID().slice(0, 6)}`, startsAt: later(3_600_000), endsAt: later(7_200_000), startingBidCents: 50_000, incrementCents: 5_000 },
    });
    const scheduled = (await created.json()) as { id: string };
    const ended = await liveLotFor(auctioneer.token);
    await sql("update public.lots set ends_at = now() - interval '1 second' where id = $1", [ended]);

    for (const [lotId, message] of [
      [scheduled.id, 'O lote ainda não começou.'],
      [ended, 'Este lote já encerrou.'],
    ] as const) {
      window.history.replaceState({}, '', `/lotes/${lotId}`);
      const view = render(<App />);
      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.queryByRole('form', { name: 'Dar lance' })).toBeNull();
      view.unmount();
    }
  });

  it('a full lot (1,000 bids) tells a bidder why they cannot bid and shows no bid form', async () => {
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    // Only what the room reads is set: the count of bids. The server refuses the 1,001st on its own (tested in the API).
    await sql('update public.lots set bid_count = 1000 where id = $1', [lotId]);
    const edna = await fundedBidder(1_000_000);
    await signInAs(edna.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);

    expect(await screen.findByText('Este lote atingiu o limite de 1.000 lances.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Dar lance' })).toBeNull();
  });

  it('an auctioneer sees the room and is told they cannot bid', async () => {
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    await signInAs(auctioneer.id);
    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    expect(await screen.findByText('Leiloeiros não dão lances.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Dar lance' })).toBeNull();
  });

  it('an auctioneer is not offered a bid on the storefront; a visitor still is', async () => {
    const auctioneer = await newAccount('auctioneer');
    await liveLotFor(auctioneer.token);
    window.history.replaceState({}, '', '/');
    const visitor = render(<App />);
    const asVisitor = await screen.findByRole('region', { name: 'Lote ao vivo em destaque' });
    expect(within(asVisitor).getByRole('link', { name: 'Dar lance' })).toBeTruthy();
    visitor.unmount();

    await signInAs(auctioneer.id);
    render(<App />);
    // The label follows the role, which is known once the account menu is there
    await screen.findByRole('button', { expanded: false });
    const asAuctioneer = await screen.findByRole('region', { name: 'Lote ao vivo em destaque' });
    expect(within(asAuctioneer).queryByRole('link', { name: 'Dar lance' })).toBeNull();
    expect(within(asAuctioneer).getByRole('link', { name: 'Ver lote' })).toBeTruthy();
  });

  it('shows the receipt of an accepted bid and keeps it across a reload', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const dora = await fundedBidder(1_000_000);
    await signInAs(dora.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    const first = render(<App />);
    const form = await screen.findByRole('form', { name: 'Dar lance' });
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    const receipts = await screen.findByRole('region', { name: 'Seus recibos' });
    const head = within(receipts).getByText(/^[0-9a-f]{64}$/).textContent;
    expect(within(receipts).getByText(/Lance nº 1/)).toBeTruthy();
    // Each receipt links to the audit with its head, so the bidder can check it with one click.
    expect(within(receipts).getByRole('link', { name: 'Conferir na auditoria' }).getAttribute('href')).toBe(`/auditoria/${lotId}?head=${head}`);
    first.unmount();

    render(<App />);
    const again = await screen.findByRole('region', { name: 'Seus recibos' });
    expect(within(again).getByText(head)).toBeTruthy();
  }, 30_000);

  it('keeps receipts per bidder on a shared device, and ignores stored data that is not a receipt list', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const eva = await fundedBidder(1_000_000);
    const fabio = await fundedBidder(1_000_000);
    window.localStorage.setItem(`receipts:${eva.id}:${lotId}`, '{"not":"a list"}');
    await signInAs(eva.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    const first = render(<App />);
    const form = await screen.findByRole('form', { name: 'Dar lance' });
    expect(screen.queryByRole('region', { name: 'Seus recibos' })).toBeNull();
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    expect(await screen.findByRole('region', { name: 'Seus recibos' })).toBeTruthy();
    first.unmount();

    await supabase.auth.signOut();
    await signInAs(fabio.id);
    render(<App />);
    await screen.findByRole('form', { name: 'Dar lance' });
    expect(screen.queryByRole('region', { name: 'Seus recibos' })).toBeNull();
  }, 30_000);

  it('keeps the valid receipts when stored data also holds an entry that is not a receipt', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const gil = await fundedBidder(1_000_000);
    const kept = { seq: 7, head: 'a'.repeat(64), placedAt: new Date().toISOString() };
    window.localStorage.setItem(`receipts:${gil.id}:${lotId}`, JSON.stringify([kept, 123]));
    await signInAs(gil.id);

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    const receipts = await screen.findByRole('region', { name: 'Seus recibos' });
    expect(within(receipts).getByText('a'.repeat(64))).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Dar lance' });
    await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
    expect(await within(receipts).findByText(/Lance nº 1/)).toBeTruthy();
    expect(within(receipts).getByText('a'.repeat(64))).toBeTruthy();
  }, 30_000);

  it('shows the receipt of a bid even when the browser refuses to store it', async () => {
    const user = userEvent.setup();
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    const hana = await fundedBidder(1_000_000);
    await signInAs(hana.id);
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage refused');
    });

    try {
      window.history.replaceState({}, '', `/lotes/${lotId}`);
      render(<App />);
      const form = await screen.findByRole('form', { name: 'Dar lance' });
      await user.click(within(form).getByRole('button', { name: /^Dar lance/ }));
      expect(await screen.findByRole('region', { name: 'Seus recibos' })).toBeTruthy();
      expect(refuse).toHaveBeenCalled();
    } finally {
      refuse.mockRestore();
    }
  }, 30_000);
});

// Signing a test account in through the real Auth API, so the app's own session is used.
async function signInAs(userId: string): Promise<void> {
  const creds = accounts.get(userId);
  if (!creds) throw new Error(`no credentials for ${userId}`);
  const result = await supabase.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (result.error) throw new Error(`sign-in failed: ${result.error.message}`);
}
