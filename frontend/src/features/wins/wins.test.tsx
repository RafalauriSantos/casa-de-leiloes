import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { supabase } from '@/lib/supabase';

// "Meus arremates" and the win receipt (J6), end to end in the UI: real API, real Postgres and Auth.
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
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

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

async function newAccount(role?: 'auctioneer'): Promise<{ token: string; email: string; password: string }> {
  const email = `w-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token: string; user: { id: string } };
  if (role) await sql('update public.profiles set role = $2 where id = $1', [body.user.id, role]);
  return { token: body.access_token, email, password };
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

/** A lot the bidder won: it ran, they placed the only bid, and its time is over. */
async function wonLot(): Promise<{ title: string; lotId: string; bidder: { email: string; password: string } }> {
  const auctioneer = await newAccount('auctioneer');
  const bidder = await newAccount();
  expect((await api('/api/wallet/deposits', bidder.token, { method: 'POST', body: { amountCents: 100_000 }, key: randomUUID() })).status).toBe(201);
  const title = `Vaso vencido ${randomUUID().slice(0, 6)}`;
  const later = (ms: number) => new Date(Date.now() + ms).toISOString();
  const created = await api('/api/lots', auctioneer.token, {
    method: 'POST',
    body: { externalId: '205482', title, startsAt: later(3_600_000), endsAt: later(7_200_000), startingBidCents: 50_000, incrementCents: 5_000 },
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as { id: string };
  await sql("update public.lots set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour' where id = $1", [lot.id]);
  expect((await api(`/api/lots/${lot.id}/bids`, bidder.token, { method: 'POST', body: { amountCents: 50_000 } })).status).toBe(201);
  await sql("update public.lots set ends_at = now() - interval '1 second' where id = $1", [lot.id]);
  return { title, lotId: lot.id, bidder };
}

describe('my wins and the win receipt (J6)', () => {
  it('a winner sees the lot in Meus arremates, opens its receipt, and the same link opens signed out', async () => {
    const user = userEvent.setup();
    const { title, bidder } = await wonLot();
    const login = await supabase.auth.signInWithPassword({ email: bidder.email, password: bidder.password });
    expect(login.error).toBeNull();
    window.history.replaceState({}, '', '/arremates');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Meus arremates' })).toBeTruthy();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Arrematados', level: 2 })).toBeTruthy();
    expect(screen.getByText('Arrematado')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Ver comprovante' }));

    expect(await screen.findByRole('heading', { name: 'Comprovante de arremate' })).toBeTruthy();
    expect(await screen.findByText(title)).toBeTruthy();
    // The header shows the available balance too, so the amount may appear more than once.
    expect(screen.getAllByText(/R\$\s*500,00/).length).toBeGreaterThan(0);
    const receiptPath = window.location.pathname;

    cleanup();
    await supabase.auth.signOut();
    window.history.replaceState({}, '', receiptPath);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Comprovante de arremate' })).toBeTruthy();
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it('explains a lot waiting for its receipt, and the refresh asks the list again', async () => {
    const user = userEvent.setup();
    const { title, lotId, bidder } = await wonLot();
    // The history no longer verifies, so the settlement refuses the lot and no receipt is written.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query('update public.bids set amount_cents = 1 where lot_id = $1', [lotId]);
      await client.query('commit');
    } finally {
      await client.end();
    }
    try {
      const login = await supabase.auth.signInWithPassword({ email: bidder.email, password: bidder.password });
      expect(login.error).toBeNull();
      window.history.replaceState({}, '', '/arremates');
      // The spy only counts the list requests; each one still goes to the real API.
      const spy = vi.spyOn(globalThis, 'fetch');
      const listRequests = () => spy.mock.calls.filter(([url]) => urlOf(url).startsWith('/api/me/wins')).length;
      render(<App />);

      expect(await screen.findByText(title)).toBeTruthy();
      expect(screen.getByText('Encerrado, aguardando o comprovante')).toBeTruthy();
      expect(screen.queryByText('Arrematado')).toBeNull();
      const before = listRequests();
      await user.click(screen.getByRole('button', { name: 'Atualizar' }));
      await waitFor(() => { expect(listRequests()).toBeGreaterThan(before); });
    } finally {
      await sql("update public.lots set status = 'cancelled' where id = $1", [lotId]);
    }
  });

  it('says so when the bidder has not bid on any lot yet', async () => {
    const lonely = await newAccount();
    const login = await supabase.auth.signInWithPassword({ email: lonely.email, password: lonely.password });
    expect(login.error).toBeNull();
    window.history.replaceState({}, '', '/arremates');
    render(<App />);

    expect(await screen.findByText(/Você ainda não deu lances/)).toBeTruthy();
  });

  it('shows an unknown receipt code as not found, never as an empty receipt', async () => {
    window.history.replaceState({}, '', '/comprovante/00000000000000000000000000000000');
    render(<App />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Valor arrematado')).toBeNull();
  });
});
