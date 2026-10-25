import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BidAccepted, OwnLot } from '@casa/contracts';
import { firstBrokenSeq, type StoredBid } from '../../src/shared/bid-chain';
import { signUpUser, type TestUser } from '../helpers/auth';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

// D21: a bidder keeps the head hash ("ponta") from the receipt of their accepted bid. If the last bid is
// later removed and the head is rewritten to the previous state, that hash no longer appears in the
// history, so the removal is detected. The attacker below has full database access: they bypass the
// append-only trigger for one transaction and rewrite the lot's head and both wallets to be consistent.

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

async function bidder(): Promise<TestUser> {
  const user = await signUpUser();
  const deposit = await fetch(`${server.url}/api/wallet/deposits`, {
    method: 'POST',
    headers: { ...json(user), 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amountCents: 1_000_000 }),
  });
  expect(deposit.status).toBe(201);
  return user;
}

async function liveLot(): Promise<OwnLot> {
  const created = await fetch(`${server.url}/api/lots`, {
    method: 'POST',
    headers: json(auctioneer),
    body: JSON.stringify(lotBody(await dbNow(server), { startingBidCents: 50_000, incrementCents: 5_000 })),
  });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [
    lot.id,
    new Date(now.getTime() - minutes(5)),
    new Date(now.getTime() + minutes(60)),
  ]);
  return lot;
}

/** Places a bid and returns the accepted-bid body: the live room and the bidder's receipt. */
async function bid(lotId: string, user: TestUser, amountCents: number): Promise<BidAccepted> {
  const response = await fetch(`${server.url}/api/lots/${lotId}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
  expect(response.status).toBe(201);
  return (await response.json()) as BidAccepted;
}

/** The head hashes that are in the database history right now. */
async function historyHashes(lotId: string): Promise<string[]> {
  const rows = await server.db.query<{ hash: string }>('select hash from public.bids where lot_id = $1', [lotId]);
  return rows.map((row) => row.hash);
}

describe('D21: the head the bidder kept is what exposes a removed last bid', () => {
  it('issues a receipt whose head is the stored head of the bid and of the lot', async () => {
    const lot = await liveLot();
    const accepted = await bid(lot.id, await bidder(), 50_000);
    const receipt = accepted.receipt;

    const [stored] = await server.db.query<{ hash: string; placed_at: Date }>('select hash, placed_at from public.bids where lot_id = $1 and seq = 1', [lot.id]);
    const [current] = await server.db.query<{ head_hash: string; head_seq: number }>('select head_hash, head_seq from public.lots where id = $1', [lot.id]);
    expect(receipt.seq).toBe(1);
    expect(receipt.head).toBe(stored?.hash);
    expect(receipt.head).toBe(current?.head_hash);
    expect(current?.head_seq).toBe(1);
    expect(receipt.placedAt).toBe(stored?.placed_at.toISOString());
  });

  it('leaves the bidder\'s kept head out of the history after the rewrite, while the rewritten history stays valid', async () => {
    const lot = await liveLot();
    const first = await bidder();
    const second = await bidder();
    await bid(lot.id, first, 50_000);
    const keptHead = (await bid(lot.id, second, 55_000)).receipt.head;

    // The attacker: remove the last bid, and set the lot's head, leader, amount and bid count, and the
    // two committed balances, back to the state before it.
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('delete from public.bids where lot_id = $1 and seq = 2', [lot.id]);
      await tx.query(
        `update public.lots set leader_id = $2, current_amount_cents = 50000, head_seq = 1, bid_count = 1, anchored_seq = least(anchored_seq, 1),
           head_hash = (select hash from public.bids where lot_id = $1 and seq = 1) where id = $1`,
        [lot.id, first.id],
      );
      await tx.query('update public.wallets set committed_cents = committed_cents - 55000 where user_id = $1', [second.id]);
      await tx.query('update public.wallets set committed_cents = committed_cents + 50000 where user_id = $1', [first.id]);
    });

    // The rewritten history passes the chain check on its own, so only the bidder's kept head can expose it.
    const rows = await server.db.query<{ seq: number; bidder_id: string; amount_cents: number; placed_at: Date; prev_hash: string; hash: string }>(
      'select seq, bidder_id, amount_cents, placed_at, prev_hash, hash from public.bids where lot_id = $1 order by seq',
      [lot.id],
    );
    const chain: StoredBid[] = rows.map((row) => ({
      lotId: lot.id,
      seq: row.seq,
      bidderId: row.bidder_id,
      amountCents: row.amount_cents,
      placedAt: row.placed_at,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
    const [head] = await server.db.query<{ head_seq: number; head_hash: string | null }>('select head_seq, head_hash from public.lots where id = $1', [lot.id]);
    expect(firstBrokenSeq(testConfig().auditHmacSecret, lot.id, chain, { seq: head?.head_seq ?? -1, hash: head?.head_hash ?? null })).toBeNull();
    expect(chain).toHaveLength(1);
    expect(await historyHashes(lot.id)).not.toContain(keptHead);
  });
});
