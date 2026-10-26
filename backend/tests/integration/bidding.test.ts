import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BIDS_PER_LOT, type OwnLot } from '@casa/contracts';
import { bidHash, genesisHash } from '../../src/shared/bid-chain';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

let server: TestServer;
let met: MetStub;
let auctioneer: TestUser;

beforeAll(async () => {
  met = await startMetStub();
  server = await startTestServer({ metApiUrl: met.baseUrl });
  auctioneer = await createAuctioneer(server);
});
afterAll(async () => {
  await server.close();
  await met.close();
});

const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });

async function bidder(depositCents = 1_000_000): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${server.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: depositCents }),
  });
  expect(deposit.status).toBe(201);
  return user;
}

async function liveLot(overrides: Record<string, unknown> = {}): Promise<OwnLot> {
  const created = await fetch(`${server.url}/api/lots`, {
    method: 'POST',
    headers: json(auctioneer),
    body: JSON.stringify(lotBody(await dbNow(server), { startingBidCents: 50_000, incrementCents: 5_000, ...overrides })),
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  // Make it live now, for an hour: the times are written from the database clock.
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [
    lot.id,
    new Date(now.getTime() - minutes(5)),
    new Date(now.getTime() + minutes(60)),
  ]);
  return lot;
}

const bid = (lotId: string, user: TestUser | undefined, amountCents: number) =>
  fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
const reason = async (response: Response) => ((await response.json()) as { code: string; message: string });

async function wallet(user: TestUser): Promise<{ totalCents: number; committedCents: number; availableCents: number }> {
  return (await (await fetch(`${server.url}/api/wallet`, { headers: json(user) })).json()) as { totalCents: number; committedCents: number; availableCents: number };
}

describe('POST /api/lots/:id/bids: who may bid', () => {
  it('refuses an anonymous visitor with 401 and an auctioneer with 403', async () => {
    const lot = await liveLot();
    expect((await bid(lot.id, undefined, 50_000)).status).toBe(401);
    const asAuctioneer = await bid(lot.id, auctioneer, 50_000);
    expect(asAuctioneer.status).toBe(403);
    expect((await reason(asAuctioneer)).code).toBe('forbidden');
  });
});

describe('POST /api/lots/:id/bids: the rules and their exact messages', () => {
  it('refuses a first bid below the starting bid with the exact minimum', async () => {
    const lot = await liveLot();
    const response = await bid(lot.id, await bidder(), 49_999);
    expect(response.status).toBe(422);
    expect(await reason(response)).toEqual({ code: 'bid_below_minimum', message: 'O lance mínimo agora é R$ 500,00.' });
  });

  it('accepts the starting bid and shows the lot as led by that bidder (pseudonym, not the user id)', async () => {
    const lot = await liveLot();
    const ana = await bidder();
    const response = await bid(lot.id, ana, 50_000);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { currentAmountCents: number; bidCount: number; leader: string; history: Array<{ bidderLabel: string }> };
    expect(body.currentAmountCents).toBe(50_000);
    expect(body.bidCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain(ana.id);
    expect(body.history[0]?.bidderLabel).toMatch(/^[0-9a-f]{12}$/);
  });

  it('refuses the leader bidding again with already_leading, and a double click does not double the bid', async () => {
    const lot = await liveLot();
    const ana = await bidder();
    const [first, second] = await Promise.all([bid(lot.id, ana, 50_000), bid(lot.id, ana, 50_000)]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(await reason(refused)).toEqual({ code: 'already_leading', message: 'Você já está ganhando este lote.' });
  });

  it('requires the next bid to be the current amount plus the increment, and releases the previous leader', async () => {
    const lot = await liveLot();
    const ana = await bidder();
    const bruno = await bidder();
    await bid(lot.id, ana, 50_000);
    expect((await wallet(ana)).committedCents).toBe(50_000);

    const low = await bid(lot.id, bruno, 54_999);
    expect((await reason(low)).message).toBe('O lance mínimo agora é R$ 550,00.');
    expect((await bid(lot.id, bruno, 55_000)).status).toBe(201);

    expect((await wallet(ana)).committedCents).toBe(0);
    expect((await wallet(bruno)).committedCents).toBe(55_000);
  });

  it('refuses a bid above the available balance with the exact available amount, and changes nothing', async () => {
    const lot = await liveLot();
    const carla = await bidder(100_000);
    const before = await wallet(carla);
    const response = await bid(lot.id, carla, 100_001);
    expect(response.status).toBe(409);
    expect(await reason(response)).toEqual({ code: 'insufficient_funds', message: 'Saldo disponível insuficiente: você tem R$ 1.000,00 para lances.' });
    expect(await wallet(carla)).toEqual(before);
  });

  it('accepts a bid that uses exactly the available balance', async () => {
    const lot = await liveLot();
    const dani = await bidder(60_000);
    expect((await bid(lot.id, dani, 60_000)).status).toBe(201);
    expect((await wallet(dani)).availableCents).toBe(0);
  });

  it('refuses a lot that has not started with lot_not_started', async () => {
    const lot = await liveLot();
    await server.db.query("update public.lots set starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' where id = $1", [lot.id]);
    const response = await bid(lot.id, await bidder(), 50_000);
    expect(response.status).toBe(409);
    const body = await reason(response);
    expect(body.code).toBe('lot_not_started');
    expect(body.message).toBe('O lote ainda não começou.');
  });

  it('refuses a lot that has ended with lot_ended', async () => {
    const lot = await liveLot();
    await server.db.query("update public.lots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' where id = $1", [lot.id]);
    const body = await reason(await bid(lot.id, await bidder(), 50_000));
    expect(body.code).toBe('lot_ended');
    expect(body.message).toBe('Este lote já encerrou.');
  });

  it('refuses a cancelled lot with lot_cancelled', async () => {
    const lot = await liveLot();
    await server.db.query("update public.lots set status = 'cancelled' where id = $1", [lot.id]);
    const response = await bid(lot.id, await bidder(), 50_000);
    expect((await reason(response)).code).toBe('lot_cancelled');
  });

  it('answers 404 for a lot that does not exist', async () => {
    expect((await bid('00000000-0000-4000-8000-000000000000', await bidder(), 50_000)).status).toBe(404);
  });

  it('refuses a non-integer or non-positive amount with 422 and records nothing', async () => {
    const lot = await liveLot();
    const ana = await bidder();
    for (const amount of [0, -1, 10.5]) {
      expect((await bid(lot.id, ana, amount)).status).toBe(422);
    }
    expect((await wallet(ana)).committedCents).toBe(0);
  });

  it('a locked lot stops editing and cancelling once it has bids (409 lot_not_editable)', async () => {
    const lot = await liveLot();
    await bid(lot.id, await bidder(), 50_000);
    const edit = await fetch(`${server.url}/api/lots/${lot.id}`, { method: 'PATCH', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    expect(edit.status).toBe(409);
    const cancel = await fetch(`${server.url}/api/lots/${lot.id}/cancel`, { method: 'POST', headers: json(auctioneer) });
    expect(cancel.status).toBe(409);
  });
});

describe('anti-sniping: a bid in the last two minutes extends the end by two minutes', () => {
  it('a lot ending in 90 seconds gets exactly two more minutes after the bid', async () => {
    const lot = await liveLot();
    const now = await dbNow(server);
    const oldEnd = new Date(now.getTime() + 90_000);
    await server.db.query('update public.lots set ends_at = $2 where id = $1', [lot.id, oldEnd]);
    const response = await bid(lot.id, await bidder(), 50_000);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { endsAt: string };
    expect(new Date(body.endsAt).getTime()).toBe(oldEnd.getTime() + 120_000);
  });
});

describe('the bid history is a hash chain that anyone with the secret can recompute', () => {
  it('links every bid to the previous one, from the genesis of the lot, and the lot points at the last bid', async () => {
    const lot = await liveLot();
    const a = await bidder();
    const b = await bidder();
    await bid(lot.id, a, 50_000);
    await bid(lot.id, b, 55_000);
    await bid(lot.id, a, 60_000);

    const rows = await server.db.query<{ seq: number; bidder_id: string; amount_cents: number; placed_at: Date; prev_hash: string; hash: string }>(
      'select seq, bidder_id, amount_cents, placed_at, prev_hash, hash from public.bids where lot_id = $1 order by seq',
      [lot.id],
    );
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    const secret = testConfig().auditHmacSecret;
    let expectedPrev = genesisHash(secret, lot.id);
    for (const row of rows) {
      expect(row.prev_hash).toBe(expectedPrev);
      const recomputed = bidHash(secret, { lotId: lot.id, seq: row.seq, bidderId: row.bidder_id, amountCents: row.amount_cents, placedAt: row.placed_at, prevHash: row.prev_hash });
      expect(row.hash).toBe(recomputed);
      expectedPrev = row.hash;
    }

    const [state] = await server.db.query<{ head_seq: number; head_hash: string; current_amount_cents: number; leader_id: string; bid_count: number }>(
      'select head_seq, head_hash, current_amount_cents, leader_id, bid_count from public.lots where id = $1',
      [lot.id],
    );
    expect(state).toEqual({ head_seq: 3, head_hash: rows[2]?.hash, current_amount_cents: 60_000, leader_id: a.id, bid_count: 3 });
  });

  it('the database refuses to change or remove a bid, even for the table owner session', async () => {
    const lot = await liveLot();
    await bid(lot.id, await bidder(), 50_000);
    await expect(server.db.query('update public.bids set amount_cents = 1 where lot_id = $1', [lot.id])).rejects.toThrow(/append-only/);
    await expect(server.db.query('delete from public.bids where lot_id = $1', [lot.id])).rejects.toThrow(/append-only/);
  });
});

describe('concurrency: parallel bids keep the lot and the balances consistent', () => {
  it('20 bidders at the same instant: the accepted bids form one contiguous, increasing chain', async () => {
    const lot = await liveLot({ startingBidCents: 10_000, incrementCents: 1_000 });
    const users = await Promise.all(Array.from({ length: 20 }, () => bidder()));
    const responses = await Promise.all(users.map((user, i) => bid(lot.id, user, 10_000 + i * 100)));
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409 || s === 422)).toBe(true);
    expect(statuses).toContain(201);

    const accepted = await server.db.query<{ seq: number; amount_cents: number }>('select seq, amount_cents from public.bids where lot_id = $1 order by seq', [lot.id]);
    expect(accepted.map((r) => r.seq)).toEqual(accepted.map((_r, i) => i + 1));
    for (let i = 1; i < accepted.length; i++) {
      expect(accepted[i]?.amount_cents ?? 0).toBeGreaterThanOrEqual((accepted[i - 1]?.amount_cents ?? 0) + 1_000);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(accepted.length);
    const [state] = await server.db.query<{ current_amount_cents: number; bid_count: number }>('select current_amount_cents, bid_count from public.lots where id = $1', [lot.id]);
    expect(state?.current_amount_cents).toBe(accepted.at(-1)?.amount_cents);
    expect(state?.bid_count).toBe(accepted.length);
    // Every outbid bidder was released: the only money still committed is the leader's current bid.
    const [committed] = await server.db.query<{ total: number }>(
      'select coalesce(sum(committed_cents), 0)::bigint as total from public.wallets where user_id = any($1::uuid[])',
      [users.map((u) => u.id)],
    );
    expect(committed?.total).toBe(state?.current_amount_cents);
  });

  it('one bidder firing ten requests at once leads at most once and never commits more than one bid', async () => {
    const lot = await liveLot();
    const user = await bidder(1_000_000);
    const responses = await Promise.all(Array.from({ length: 10 }, (_v, i) => bid(lot.id, user, 50_000 + i * 5_000)));
    expect(responses.every((r) => [201, 409, 422].includes(r.status))).toBe(true);
    expect(responses.filter((r) => r.status === 201).length).toBeLessThanOrEqual(1);
    const [state] = await server.db.query<{ leader_id: string | null; current_amount_cents: number | null }>(
      'select leader_id, current_amount_cents from public.lots where id = $1',
      [lot.id],
    );
    // Committed money is exactly the leading amount when this bidder leads, and nothing otherwise.
    const expectedCommitted = state?.leader_id === user.id ? state.current_amount_cents : 0;
    expect((await wallet(user)).committedCents).toBe(expectedCommitted);
  });

  it('one balance in two lots at once: the money is committed at most once', async () => {
    const lotA = await liveLot();
    const lotB = await liveLot();
    const user = await bidder(100_000);
    const responses = await Promise.all([bid(lotA.id, user, 80_000), bid(lotB.id, user, 80_000)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await wallet(user)).committedCents).toBe(80_000);
    expect((await wallet(user)).availableCents).toBe(20_000);
  });

  it('bids crossing between two lots from many users finish without deadlock and never overdraw', async () => {
    const lotA = await liveLot();
    const lotB = await liveLot();
    const users = await Promise.all(Array.from({ length: 6 }, () => bidder(200_000)));
    const jobs = users.flatMap((user, i) => [bid(lotA.id, user, 50_000 + i * 5_000), bid(lotB.id, user, 50_000 + i * 5_000)]);
    const responses = await Promise.all(jobs);
    expect(responses.some((r) => r.status === 500)).toBe(false);
    for (const user of users) {
      const w = await wallet(user);
      expect(w.availableCents).toBeGreaterThanOrEqual(0);
      expect(w.committedCents).toBeLessThanOrEqual(w.totalCents);
    }
    const [sum] = await server.db.query<{ committed: number }>(
      `select coalesce(sum(committed_cents), 0)::bigint as committed from public.wallets where user_id = any($1::uuid[])`,
      [users.map((u) => u.id)],
    );
    const [leading] = await server.db.query<{ total: number }>(
      'select coalesce(sum(current_amount_cents), 0)::bigint as total from public.lots where leader_id = any($1::uuid[]) and id = any($2::uuid[])',
      [users.map((u) => u.id), [lotA.id, lotB.id]],
    );
    expect(sum?.committed).toBe(leading?.total);
  });
});

describe('GET /api/lots/:id/live: the room\'s view', () => {
  it('still says "outbid" to someone who bid long before the last 50 bids', async () => {
    const lot = await liveLot({ startingBidCents: 10_000, incrementCents: 100 });
    const early = await bidder();
    await bid(lot.id, early, 10_000);
    // Fifty later bids push the early bidder out of the history window.
    for (let i = 1; i <= 50; i++) {
      const next = await bidder();
      expect((await bid(lot.id, next, 10_000 + i * 100)).status).toBe(201);
    }
    const view = (await (await fetch(`${server.url}/api/lots/${lot.id}/live`, { headers: json(early) })).json()) as { position: string; history: unknown[] };
    expect(view.history).toHaveLength(50);
    expect(view.position).toBe('outbid');
  }, 60_000);

  it('is public and shows no user ids, and marks my position only when I am signed in', async () => {
    const lot = await liveLot();
    const ana = await bidder();
    const bruno = await bidder();
    await bid(lot.id, ana, 50_000);

    const anon = (await (await fetch(`${server.url}/api/lots/${lot.id}/live`)).json()) as { position?: string; serverNow: string; state: string };
    expect(anon.state).toBe('live');
    expect(anon.position).toBeUndefined();
    expect(new Date(anon.serverNow).getTime()).toBeGreaterThan(0);

    const leading = (await (await fetch(`${server.url}/api/lots/${lot.id}/live`, { headers: json(ana) })).json()) as { position: string };
    expect(leading.position).toBe('leading');

    await bid(lot.id, bruno, 55_000);
    const outbid = (await (await fetch(`${server.url}/api/lots/${lot.id}/live`, { headers: json(ana) })).json()) as { position: string; history: unknown[] };
    expect(outbid.position).toBe('outbid');
    const none = (await (await fetch(`${server.url}/api/lots/${lot.id}/live`, { headers: json(await bidder()) })).json()) as { position: string };
    expect(none.position).toBe('none');

    const text = JSON.stringify(outbid);
    expect(text).not.toContain(ana.id);
    expect(text).not.toContain(bruno.id);
  });
});

// D23: a lot takes at most MAX_BIDS_PER_LOT bids, so its anchor file always fits what the publisher accepts.
describe('the limit of bids per lot', () => {
  // These lots stay live for an hour with 1,000 bids each: the database is shared, so they are cancelled afterwards
  // and cannot crowd the showcase of the tests that run after.
  const made: string[] = [];
  afterAll(async () => {
    await server.db.query("update public.lots set status = 'cancelled' where id = any($1::uuid[])", [made]);
  });

  it('takes the 1,000th bid and refuses the 1,001st with bid_limit_reached, without moving any money', async () => {
    const lot = await liveLot();
    made.push(lot.id);
    const [ana, bruno, carla] = await Promise.all([bidder(10_000_000), bidder(10_000_000), bidder(10_000_000)]);
    for (let index = 0; index < MAX_BIDS_PER_LOT; index += 1) {
      expect((await bid(lot.id, index % 2 === 0 ? ana : bruno, 50_000 + index * 5_000)).status).toBe(201);
    }
    const committed = async (user: TestUser) => (await server.db.query<{ committed_cents: number }>('select committed_cents from public.wallets where user_id = $1', [user.id]))[0]?.committed_cents;
    const before = [await committed(ana), await committed(bruno), await committed(carla)];

    const refused = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(carla), body: JSON.stringify({ amountCents: 50_000 + MAX_BIDS_PER_LOT * 5_000 }) });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ code: 'bid_limit_reached', message: 'Este lote atingiu o limite de 1.000 lances.' });
    expect([await committed(ana), await committed(bruno), await committed(carla)]).toEqual(before);
    const [row] = await server.db.query<{ head_seq: number; bid_count: number }>('select head_seq, bid_count from public.lots where id = $1', [lot.id]);
    expect(row).toEqual({ head_seq: MAX_BIDS_PER_LOT, bid_count: MAX_BIDS_PER_LOT });
    const audit = (await (await fetch(`${server.url}/api/lots/${lot.id}/audit`)).json()) as { bids: unknown[]; chain: { status: string } };
    expect(audit.bids).toHaveLength(MAX_BIDS_PER_LOT);
    expect(audit.chain).toEqual({ status: 'intact' });
  }, 180_000);

  it('lets exactly one of two parallel bids take the last place', async () => {
    const lot = await liveLot();
    made.push(lot.id);
    const [ana, bruno, carla, dani] = await Promise.all([bidder(10_000_000), bidder(10_000_000), bidder(10_000_000), bidder(10_000_000)]);
    for (let index = 0; index < MAX_BIDS_PER_LOT - 1; index += 1) {
      expect((await bid(lot.id, index % 2 === 0 ? ana : bruno, 50_000 + index * 5_000)).status).toBe(201);
    }
    const next = 50_000 + (MAX_BIDS_PER_LOT - 1) * 5_000;

    const [one, two] = await Promise.all([
      fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(carla), body: JSON.stringify({ amountCents: next }) }),
      fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(dani), body: JSON.stringify({ amountCents: next + 5_000 }) }),
    ]);

    expect([one.status, two.status].filter((status) => status === 201)).toHaveLength(1);
    // The limit is judged before the minimum, so whoever comes second is always refused for the limit, whatever it offered.
    const loser = one.status === 201 ? two : one;
    expect(loser.status).toBe(409);
    expect(((await loser.json()) as { code: string }).code).toBe('bid_limit_reached');
    const [row] = await server.db.query<{ head_seq: number }>('select head_seq from public.lots where id = $1', [lot.id]);
    expect(row?.head_seq).toBe(MAX_BIDS_PER_LOT);
    const [{ count } = { count: -1 }] = await server.db.query<{ count: number }>('select count(*)::int as count from public.bids where lot_id = $1', [lot.id]);
    expect(count).toBe(MAX_BIDS_PER_LOT);
  }, 180_000);
});
