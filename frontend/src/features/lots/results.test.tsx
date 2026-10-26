import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { supabase } from '@/lib/supabase';

// The auctioneer's results (B3, 1.7), end to end in the UI: real API, real Postgres and Auth.
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

async function newAccount(role?: 'auctioneer'): Promise<{ id: string; token: string; email: string; password: string }> {
  const email = `res-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token: string; user: { id: string } };
  if (role) await sql('update public.profiles set role = $2 where id = $1', [body.user.id, role]);
  return { id: body.user.id, token: body.access_token, email, password };
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

/** A lot that has ended: sold to one bidder for 55,000, or left with no bids. It is settled by a read unless `settle` is false. */
async function endedLot(auctioneer: { token: string; id: string }, bidder: { token: string } | undefined, title: string, settle = true): Promise<void> {
  const later = (ms: number) => new Date(Date.now() + ms).toISOString();
  const created = await api('/api/lots', auctioneer.token, {
    method: 'POST',
    body: { externalId: '205482', title, startsAt: later(3_600_000), endsAt: later(7_200_000), startingBidCents: 50_000, incrementCents: 5_000 },
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as { id: string };
  await sql("update public.lots set starts_at = now() - interval '2 hours', ends_at = now() + interval '1 hour' where id = $1", [lot.id]);
  if (bidder) {
    const deposit = await api('/api/wallet/deposits', bidder.token, { method: 'POST', body: { amountCents: 1_000_000 }, key: randomUUID() });
    expect(deposit.status).toBe(201);
    expect((await api(`/api/lots/${lot.id}/bids`, bidder.token, { method: 'POST', body: { amountCents: 55_000 } })).status).toBe(201);
  }
  await sql("update public.lots set ends_at = now() - interval '1 second' where id = $1", [lot.id]);
  if (settle) expect((await fetch(`${window.location.origin}/api/lots/${lot.id}`)).status).toBe(200);
}

describe('the auctioneer panel shows the results (B3, 1.7)', () => {
  it('shows what each ended lot sold for, its no-bids state, and the total received', async () => {
    const auctioneer = await newAccount('auctioneer');
    const buyer = await newAccount();
    const title = `Sold ${randomUUID().slice(0, 6)}`;
    await endedLot(auctioneer, buyer, title);
    await endedLot(auctioneer, undefined, `Empty ${randomUUID().slice(0, 6)}`);
    const waiting = await newAccount();
    await endedLot(auctioneer, waiting, `Waiting ${randomUUID().slice(0, 6)}`, false);

    const login = await supabase.auth.signInWithPassword({ email: auctioneer.email, password: auctioneer.password });
    expect(login.error).toBeNull();
    window.history.replaceState({}, '', '/leiloeiro');
    render(<App />);

    expect(await screen.findByText(/Total recebido: R\$\s*550,00/)).toBeTruthy();
    expect(screen.getByText(/1 de 2 lote\(s\) encerrado\(s\) vendido\(s\)/)).toBeTruthy();
    await waitFor(() => { expect(screen.getByText(/Arrematado por R\$\s*550,00/)).toBeTruthy(); });
    expect(screen.getByText(/Encerrado sem lances/)).toBeTruthy();
    expect(screen.getByText(/Encerrado · aguardando liquidação/)).toBeTruthy();
  });
});

describe('cancelling a lot with bids from the panel (B19, 9.1)', () => {
  it('asks to confirm, says the leader is refunded, and the leader gets the committed money back', async () => {
    const auctioneer = await newAccount('auctioneer');
    const bidder = await newAccount();
    const title = `Refund ${randomUUID().slice(0, 6)}`;
    const later = (ms: number) => new Date(Date.now() + ms).toISOString();
    const created = await api('/api/lots', auctioneer.token, {
      method: 'POST',
      body: { externalId: '205482', title, startsAt: later(3_600_000), endsAt: later(7_200_000), startingBidCents: 50_000, incrementCents: 5_000 },
    });
    const lot = (await created.json()) as { id: string };
    await sql("update public.lots set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour' where id = $1", [lot.id]);
    expect((await api('/api/wallet/deposits', bidder.token, { method: 'POST', body: { amountCents: 1_000_000 }, key: randomUUID() })).status).toBe(201);
    expect((await api(`/api/lots/${lot.id}/bids`, bidder.token, { method: 'POST', body: { amountCents: 55_000 } })).status).toBe(201);

    expect((await supabase.auth.signInWithPassword({ email: auctioneer.email, password: auctioneer.password })).error).toBeNull();
    window.history.replaceState({}, '', '/leiloeiro');
    render(<App />);
    const user = userEvent.setup();
    const card = (await screen.findByRole('heading', { name: title })).closest('article');
    if (!card) throw new Error('the lot card is missing');

    await user.click(within(card).getByRole('button', { name: 'Cancelar lote' }));
    expect(within(card).getByText(/devolve na hora o valor comprometido de quem lidera/)).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await screen.findByText(`Lote "${title}" cancelado. O valor do lance líder voltou para o licitante.`)).toBeTruthy();
    const wallet = (await (await api('/api/wallet', bidder.token)).json()) as { committedCents: number };
    expect(wallet.committedCents).toBe(0);
  });
});
