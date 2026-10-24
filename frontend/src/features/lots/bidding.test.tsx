import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
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
    await user.click(within(form).getByRole('button', { name: 'Dar lance' }));
    expect(await screen.findByText('Você está ganhando.')).toBeTruthy();

    // Bruno outbids her through the API; her screen catches up on its own (polling every 3 s).
    const outbid = await api(`/api/lots/${lotId}/bids`, bruno.token, { method: 'POST', body: { amountCents: 55_000 } });
    expect(outbid.status).toBe(201);
    expect(await screen.findByText('Você foi superado.', undefined, { timeout: 8_000 })).toBeTruthy();
    // The current bid is shown in the room (and again in the history).
    expect(within(room).getByText('Lance atual').closest('div')?.textContent).toContain('R$ 550,00');
    expect(within(room).getAllByText('Você').length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('a refused bid shows the exact reason and keeps the amount typed', async () => {
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
    await user.click(within(form).getByRole('button', { name: 'Dar lance' }));
    expect((await within(form).findByRole('alert')).textContent).toBe('Saldo disponível insuficiente: você tem R$ 100,00 para lances.');
    expect(input.value).toBe('500,00');
  });

  it('a visitor sees the room without a bid form and is asked to sign in', async () => {
    const auctioneer = await newAccount('auctioneer');
    const lotId = await liveLotFor(auctioneer.token);
    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);
    expect(await screen.findByText('Entre como licitante para dar lances.')).toBeTruthy();
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
});

// Signing a test account in through the real Auth API, so the app's own session is used.
async function signInAs(userId: string): Promise<void> {
  const creds = accounts.get(userId);
  if (!creds) throw new Error(`no credentials for ${userId}`);
  const result = await supabase.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (result.error) throw new Error(`sign-in failed: ${result.error.message}`);
}
