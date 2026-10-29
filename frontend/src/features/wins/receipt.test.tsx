import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditReport } from '@casa/contracts';
import { App } from '@/app/App';
import { headlineText } from '@/features/audit';

// The win receipt, public by its code (B40): the warning for a changed history, and copying the link. Real API and Postgres.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const API = process.env.VITE_SUPABASE_URL ?? '';

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function newAccount(role?: 'auctioneer'): Promise<{ id: string; token: string }> {
  const email = `rec-${randomUUID()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token: string; user: { id: string } };
  if (role) await withDb((db) => db.query('update public.profiles set role = $2 where id = $1', [body.user.id, role]));
  return { id: body.user.id, token: body.access_token };
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

/** A lot sold to one bidder, ended and settled by a read, so it has a win receipt. Returns the lot id and the receipt code. */
async function soldLot(auctioneer: { token: string }, bidder: { token: string }, title: string): Promise<{ lotId: string; code: string }> {
  const later = (ms: number) => new Date(Date.now() + ms).toISOString();
  const created = await api('/api/lots', auctioneer.token, {
    method: 'POST',
    body: { externalId: '205482', title, startsAt: later(3_600_000), endsAt: later(7_200_000), startingBidCents: 50_000, incrementCents: 5_000 },
  });
  const { id: lotId } = (await created.json()) as { id: string };
  await withDb((db) => db.query("update public.lots set starts_at = now() - interval '2 hours', ends_at = now() + interval '1 hour' where id = $1", [lotId]));
  const deposit = await api('/api/wallet/deposits', bidder.token, { method: 'POST', body: { amountCents: 1_000_000 }, key: randomUUID() });
  expect(deposit.status).toBe(201);
  expect((await api(`/api/lots/${lotId}/bids`, bidder.token, { method: 'POST', body: { amountCents: 55_000 } })).status).toBe(201);
  await withDb((db) => db.query("update public.lots set ends_at = now() - interval '1 second' where id = $1", [lotId]));
  expect((await fetch(`${window.location.origin}/api/lots/${lotId}`)).status).toBe(200);
  const code = await withDb(async (db) => {
    const { rows } = await db.query<{ code: string }>('select code from public.receipts where lot_id = $1', [lotId]);
    if (!rows[0]) throw new Error('the sold lot has no receipt');
    return rows[0].code;
  });
  return { lotId, code };
}

/** Changes the first bid directly in the database, past the trigger that refuses updates, as the seed does for its demo lot. */
async function changeFirstBid(lotId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    await db.query('update public.bids set amount_cents = amount_cents + 1 where lot_id = $1 and seq = 1', [lotId]);
    await db.query('commit');
  });
}

describe('the win receipt (B40)', () => {
  it('warns when the history of the lot was changed, and says the history is intact when it is not', async () => {
    const auctioneer = await newAccount('auctioneer');
    const buyer = await newAccount();
    const intact = await soldLot(auctioneer, buyer, `Intacto ${randomUUID().slice(0, 6)}`);
    const changed = await soldLot(auctioneer, buyer, `Alterado ${randomUUID().slice(0, 6)}`);
    await changeFirstBid(changed.lotId);

    window.history.replaceState({}, '', `/comprovante/${changed.code}`);
    const changedView = render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('histórico');
    changedView.unmount();

    window.history.replaceState({}, '', `/comprovante/${intact.code}`);
    render(<App />);
    // The receipt shows the audit's own verdict for the lot, never a lot-wide "intact" line of its own (B40).
    const receipt = (await (await fetch(`${window.location.origin}/api/receipts/${intact.code}`)).json()) as { headHash: string };
    const audit = (await (await fetch(`${window.location.origin}/api/lots/${intact.lotId}/audit?head=${receipt.headHash}`)).json()) as AuditReport;
    const verdict = headlineText(audit.headline).title;
    const status = await screen.findByRole('status', {}, { timeout: 8_000 });
    expect(status.textContent).toContain(verdict);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/sem alteração/)).toBeNull();
  }, 60_000);

  it('says the check could not run when the history cannot be read, instead of saying nothing', async () => {
    const auctioneer = await newAccount('auctioneer');
    const buyer = await newAccount();
    const sold = await soldLot(auctioneer, buyer, `Sem leitura ${randomUUID().slice(0, 6)}`);
    const real = window.fetch.bind(window);
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/audit') ? Promise.reject(new TypeError('network down')) : real(input, init);
    });

    window.history.replaceState({}, '', `/comprovante/${sold.code}`);
    render(<App />);
    expect(await screen.findByText('Não foi possível conferir o histórico agora.')).toBeTruthy();
  }, 60_000);

  it('copies the receipt link and says so, or says it could not when the browser refuses (B40)', async () => {
    const auctioneer = await newAccount('auctioneer');
    const buyer = await newAccount();
    const sold = await soldLot(auctioneer, buyer, `Copia ${randomUUID().slice(0, 6)}`);
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    window.history.replaceState({}, '', `/comprovante/${sold.code}`);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Copiar link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível copiar o link. Copie o endereço da barra do navegador.');
    await user.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(await screen.findByText('Link copiado.')).toBeTruthy();
  }, 60_000);
});
