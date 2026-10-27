import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditReport } from '@casa/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/app/App';
import { AuditView } from './components/AuditView';

// The audit page: its view from data of every case, and the whole page through the real API, Postgres and Auth.
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

const HASH = (letter: string) => letter.repeat(64);
const bid = (seq: number, hash: string) => ({ seq, bidderLabel: seq % 2 === 0 ? 'b2b2b2b2b2b2' : 'a1a1a1a1a1a1', amountCents: 50_000 + seq * 5_000, placedAt: `2030-01-01T12:0${String(seq)}:00Z`, hash });
const report = (over: Partial<AuditReport>): AuditReport => ({
  lotId: randomUUID(),
  bids: [bid(1, HASH('a')), bid(2, HASH('b'))],
  chain: { status: 'intact' },
  anchor: { status: 'published', publishedThroughSeq: 2 },
  headline: { kind: 'no_divergence_until', publishedThroughSeq: 2 },
  ...over,
});

const view = (data: AuditReport, head?: string) => render(<MemoryRouter><AuditView report={data} head={head} onHead={() => undefined} /></MemoryRouter>);

describe('AuditView, from data', () => {
  it('shows the headline, the three results, and every bid with its pseudonym, amount, time and hash', () => {
    view(report({ receiptHead: { status: 'in_history', seq: 2 }, headline: { kind: 'intact_until', seq: 2 } }), HASH('b'));

    expect(screen.getByRole('heading', { level: 2, name: 'Íntegro até o lance 2' })).toBeTruthy();
    expect(screen.getByText('Cadeia sem quebra até o lance 2')).toBeTruthy();
    expect(screen.getByText('Âncora publicada até o lance 2')).toBeTruthy();
    expect(screen.getByText('Sua ponta é a do lance 2')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Histórico de lances' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('a1a1a1a1a1a1');
    expect(rows[0]?.textContent).toContain('R$ 550,00');
    expect(rows[0]?.textContent).toContain(HASH('a'));
  });

  it('shows the tampered headline in an alert, with where the chain breaks', () => {
    view(report({ chain: { status: 'tampered', brokenAtSeq: 2 }, headline: { kind: 'tampered' } }));

    expect(screen.getByRole('alert').textContent).toContain('Adulterado');
    expect(screen.getByText('Cadeia quebrada no lance 2')).toBeTruthy();
  });

  it('shows "Não confirmado" for a head that was not found, without the word adulterado in the headline', () => {
    view(report({ receiptHead: { status: 'not_in_history' }, headline: { kind: 'unconfirmed' } }), HASH('f'));

    expect(screen.getByRole('heading', { level: 2, name: 'Não confirmado' })).toBeTruthy();
    expect(screen.getByText('Ponta não encontrada neste histórico')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says there are no bids for an empty lot, with no table', () => {
    view(report({ bids: [], headline: { kind: 'no_bids', anchorUnverified: false }, anchor: { status: 'published', publishedThroughSeq: 0 } }));

    expect(screen.getByRole('heading', { level: 2, name: 'Sem lances' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps the receipt form: the typed head goes to the page', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<MemoryRouter><AuditView report={report({})} head={undefined} onHead={(head) => seen.push(head)} /></MemoryRouter>);

    await user.type(screen.getByLabelText('Ponta do seu recibo'), `  ${HASH('c')}  `);
    await user.click(screen.getByRole('button', { name: 'Conferir' }));

    expect(seen).toEqual([HASH('c')]);
  });

  it('turns what is typed into a lowercase, trimmed head: a pasted uppercase hash is not refused by the server', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<MemoryRouter><AuditView report={report({})} head={undefined} onHead={(head) => seen.push(head)} /></MemoryRouter>);

    await user.type(screen.getByLabelText('Ponta do seu recibo'), ` ${HASH('C')} `);
    await user.click(screen.getByRole('button', { name: 'Conferir' }));

    expect(seen).toEqual([HASH('c')]);
  });

  it('always says, under the results, that a last bid removed before its publication is only caught by a receipt', () => {
    view(report({}));

    expect(screen.getByText(/removido antes de ser publicado só aparece com um recibo/)).toBeTruthy();
  });

  it('puts the bid table in a region the keyboard can scroll', () => {
    view(report({}));

    const region = screen.getByRole('region', { name: 'Lances' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(within(region).getByRole('table', { name: 'Histórico de lances' })).toBeTruthy();
  });

  it('shows a stale pending anchor as an incident', () => {
    view(report({ anchor: { status: 'pending', publishedThroughSeq: 1, stale: true }, headline: { kind: 'no_divergence_until', publishedThroughSeq: 1 } }));

    expect(screen.getByText(/aguardam publicação há 10 minutos ou mais/)).toBeTruthy();
  });
});

// ---- the whole page, through the real API ----

const API = process.env.VITE_SUPABASE_URL ?? '';

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(text, params);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

async function account(role?: 'auctioneer'): Promise<{ id: string; token: string }> {
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
    body: JSON.stringify({ email: `a-${randomUUID()}@example.test`, password: randomBytes(12).toString('hex') }),
  });
  const body = (await response.json()) as { access_token: string; user: { id: string } };
  if (role) await sql('update public.profiles set role = $2 where id = $1', [body.user.id, role]);
  return { id: body.user.id, token: body.access_token };
}

async function api(path: string, token: string, method: string, body?: unknown, key?: string): Promise<Response> {
  return fetch(`${window.location.origin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A live lot with one bid of R$ 500,00, and the head of that bid. */
async function lotWithOneBid(): Promise<{ lotId: string; head: string }> {
  const auctioneer = await account('auctioneer');
  const created = await api('/api/lots', auctioneer.token, 'POST', { externalId: '205482', title: `Vaso ${randomUUID().slice(0, 6)}`, startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(), startingBidCents: 50_000, incrementCents: 5_000 });
  expect(created.status).toBe(201);
  const { id: lotId } = (await created.json()) as { id: string };
  await sql("update public.lots set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour' where id = $1", [lotId]);
  const bidder = await account();
  expect((await api('/api/wallet/deposits', bidder.token, 'POST', { amountCents: 1_000_000 }, randomUUID())).status).toBe(201);
  const placed = await api(`/api/lots/${lotId}/bids`, bidder.token, 'POST', { amountCents: 50_000 });
  expect(placed.status).toBe(201);
  const { receipt } = (await placed.json()) as { receipt: { head: string } };
  return { lotId, head: receipt.head };
}

describe('the audit page, through the real API', () => {
  it('shows an untouched lot with its bid, and says only that the anchor was not verified (it is off in tests)', async () => {
    const { lotId } = await lotWithOneBid();

    window.history.replaceState({}, '', `/auditoria/${lotId}`);
    render(<App />);

    expect(screen.getByText('Carregando auditoria…')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Âncora não verificada' })).toBeTruthy();
    expect(screen.getByText('A âncora não está configurada neste ambiente')).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Histórico de lances' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('R$ 500,00');
  });

  it('finds the head of a receipt, from the address and from the form', async () => {
    const user = userEvent.setup();
    const { lotId, head } = await lotWithOneBid();

    window.history.replaceState({}, '', `/auditoria/${lotId}`);
    render(<App />);
    await screen.findByRole('heading', { level: 2, name: 'Âncora não verificada' });
    fireEvent.change(screen.getByLabelText('Ponta do seu recibo'), { target: { value: head } });
    await user.click(screen.getByRole('button', { name: 'Conferir' }));

    expect(await screen.findByText('Sua ponta é a do lance 1')).toBeTruthy();
    expect(window.location.search).toBe(`?head=${head}`);
    cleanup();

    window.history.replaceState({}, '', `/auditoria/${lotId}?head=${'a'.repeat(64)}`);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Não confirmado' })).toBeTruthy();
  });

  it('shows "Adulterado" and where the chain breaks when the database was altered', async () => {
    const { lotId } = await lotWithOneBid();
    await sql('update public.bids set amount_cents = 1 where lot_id = $1 and seq = 1', [lotId]);

    window.history.replaceState({}, '', `/auditoria/${lotId}`);
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toContain('Adulterado');
    expect(screen.getByText('Cadeia quebrada no lance 1')).toBeTruthy();
  });

  it('says "Lote não encontrado." for a lot that does not exist and refuses a malformed head with the server message', async () => {
    window.history.replaceState({}, '', `/auditoria/${randomUUID()}`);
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toBe('Lote não encontrado.');
    cleanup();

    const { lotId } = await lotWithOneBid();
    window.history.replaceState({}, '', `/auditoria/${lotId}?head=abc`);
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('64 caracteres');
  });

  it('keeps the receipt form after a refused head, so it can be corrected or cleared without editing the address', async () => {
    const user = userEvent.setup();
    const { lotId, head } = await lotWithOneBid();

    window.history.replaceState({}, '', `/auditoria/${lotId}?head=${head.slice(0, 20)}`);
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('64 caracteres');
    const input = screen.getByLabelText<HTMLInputElement>('Ponta do seu recibo');
    expect(input.value).toBe(head.slice(0, 20));

    fireEvent.change(input, { target: { value: head } });
    await user.click(screen.getByRole('button', { name: 'Conferir' }));
    expect(await screen.findByText('Sua ponta é a do lance 1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    window.history.replaceState({}, '', `/auditoria/${lotId}?head=abc`);
    render(<App />);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Limpar ponta' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Âncora não verificada' })).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('does not show the receipt form for a lot that does not exist and was opened without a head', async () => {
    window.history.replaceState({}, '', `/auditoria/${randomUUID()}`);
    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toBe('Lote não encontrado.');
    expect(screen.queryByLabelText('Ponta do seu recibo')).toBeNull();
  });

  it('is linked from the lot page', async () => {
    const { lotId } = await lotWithOneBid();

    window.history.replaceState({}, '', `/lotes/${lotId}`);
    render(<App />);

    const link = await screen.findByRole('link', { name: 'Auditar histórico' });
    expect(link.getAttribute('href')).toBe(`/auditoria/${lotId}`);
  });
});
