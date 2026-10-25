import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OwnLot } from '@casa/contracts';
import type { Config } from '../../src/config';
import { releaseTamperedLot, reviewTamperedLot } from '../../src/modules/settlement';
import { signUpUser, type TestUser } from '../helpers/auth';
import { recorded, startGithubStub, type GithubStub, type StubAnswer } from '../helpers/github-stub';
import { createAuctioneer, dbNow, lotBody, minutes } from '../helpers/lots';
import { startMetStub, type MetStub } from '../helpers/met-stub';
import { startTestServer, type TestServer } from '../helpers/server';
import { testConfig } from '../helpers/test-config';

// D20, built: the owner releases the money committed on a lot whose history fails verification. Nobody else can:
// there is no endpoint, only this function, which the owner runs with the privileged connection. The release
// never pays anyone: the winner's committed money goes back to the available balance, the lot is marked
// integrity_cancelled, and an append-only row records who decided, when, why, and the first broken seq.

let met: MetStub;
let github: GithubStub;
let server: TestServer;
let auctioneer: TestUser;
let config: Config;
/** Lots these tests made: each one is put aside at the end, so no later test retries them. */
const made: string[] = [];

beforeAll(async () => {
  met = await startMetStub();
  github = await startGithubStub({ fallback: true });
  config = { ...testConfig(), metApiUrl: met.baseUrl, anchor: { mode: 'github', repo: 'owner/anchor', token: 'test-token', apiUrl: github.baseUrl, branch: 'main' } };
  server = await startTestServer(config);
  auctioneer = await createAuctioneer(server);
});
afterAll(async () => {
  await server.db.query("update public.lots set status = 'cancelled' where id = any($1::uuid[]) and settled_at is null", [made]);
  await server.close();
  await github.close();
  await met.close();
});
beforeEach(async () => {
  github.reset();
  // Other test files leave ended lots that never settle; this file looks only at its own lots.
  await server.db.query("update public.lots set status = 'cancelled' where status = 'active' and settled_at is null and ends_at <= now() and id <> all($1::uuid[])", [made]);
  // A healthy settled lot is always among the latest sold ones, so the secret is checked against a lot no test has tampered.
  const { lot } = await endedLot();
  await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
  await fetch(`${server.url}/api/lots/${lot.id}`);
  expect((await stateOf(lot.id))?.outcome).toBe('sold');
});

const json = (user?: TestUser) => ({ 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) });
const fileOf = (lotId: string) => `lots/${lotId}.csv`;

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

/** A lot that ended with two bids, the second one winning at 55,000. */
async function endedLot(existingWinner?: TestUser): Promise<{ lot: OwnLot; first: TestUser; winner: TestUser }> {
  const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server), { startingBidCents: 50_000, incrementCents: 5_000 })) });
  expect(created.status).toBe(201);
  const lot = (await created.json()) as OwnLot;
  made.push(lot.id);
  const now = await dbNow(server);
  await server.db.query('update public.lots set starts_at = $2, ends_at = $3 where id = $1', [lot.id, new Date(now.getTime() - minutes(5)), new Date(now.getTime() + minutes(60))]);
  const first = await bidder();
  const winner = existingWinner ?? (await bidder());
  for (const [user, amountCents] of [[first, 50_000], [winner, 55_000]] as const) {
    const placed = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(user), body: JSON.stringify({ amountCents }) });
    expect(placed.status).toBe(201);
  }
  await server.db.query('update public.lots set ends_at = $2 where id = $1', [lot.id, new Date((await dbNow(server)).getTime() - 1_000)]);
  return { lot, first, winner };
}

/** Someone with direct database access changes the second bid's amount: the history no longer verifies. */
async function tamper(lotId: string, seq: number): Promise<void> {
  await server.db.tx(async (tx) => {
    await tx.query('set local session_replication_role = replica');
    await tx.query('update public.bids set amount_cents = 1 where lot_id = $1 and seq = $2', [lotId, seq]);
  });
}

/** What the owner confirms for a lot: the leader and the amount its own copy holds (the owner reads both sources first). */
const confirmed = async (lotId: string) => {
  const [row] = await server.db.query<{ leader_id: string | null; current_amount_cents: number | null }>('select leader_id, current_amount_cents from public.lots where id = $1', [lotId]);
  return { leaderId: row?.leader_id ?? null, amountCents: row?.current_amount_cents ?? 0 };
};

const stateOf = async (lotId: string) =>
  (await server.db.query<{ status: string; settled_at: Date | null; outcome: string | null; current_amount_cents: number | null }>(
    'select status, settled_at, outcome, current_amount_cents from public.lots where id = $1',
    [lotId],
  ))[0];
const committedOf = async (user: TestUser) =>
  (await server.db.query<{ total_cents: number; committed_cents: number }>('select total_cents, committed_cents from public.wallets where user_id = $1', [user.id]))[0];
const decisionsOf = async (lotId: string) =>
  server.db.query<{ decided_by: string; reason: string; broken_seq: number }>(
    'select decided_by, reason, broken_seq from public.integrity_decisions where lot_id = $1',
    [lotId],
  );
const ledgerOf = async (lotId: string) =>
  (await server.db.query<{ n: number }>("select count(*)::int as n from public.wallet_ledger where lot_id = $1 and kind in ('lot_debit','lot_credit')", [lotId]))[0]?.n ?? -1;
const receiptsOf = async (lotId: string) =>
  (await server.db.query<{ n: number }>('select count(*)::int as n from public.receipts where lot_id = $1', [lotId]))[0]?.n ?? -1;

describe('the owner releases the money of a lot whose history fails verification (D20)', () => {
  it('releases the winner money back to the available balance, marks the lot, and pays nobody', async () => {
    const { lot, winner } = await endedLot();
    const auctioneerBefore = await committedOf(auctioneer);
    const before = await committedOf(winner);
    expect(before?.committed_cents).toBe(55_000);
    await tamper(lot.id, 2);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'Lance 2 alterado no banco; ver o incidente.', ...(await confirmed(lot.id)) });

    const after = await committedOf(winner);
    expect(after?.committed_cents).toBe(0);
    expect(after?.total_cents).toBe(before?.total_cents);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled', settled_at: null, outcome: null });
    expect(await committedOf(auctioneer)).toEqual(auctioneerBefore);
    expect(await ledgerOf(lot.id)).toBe(0);
    expect(await receiptsOf(lot.id)).toBe(0);
  });

  it('records one decision with who decided, why, and the first broken seq', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'Lance 2 alterado no banco.', ...(await confirmed(lot.id)) });

    expect(await decisionsOf(lot.id)).toEqual([{ decided_by: 'owner', reason: 'Lance 2 alterado no banco.', broken_seq: 2 }]);
  });

  it('refuses a lot whose history verifies: there is nothing to release, and the money stays where it is', async () => {
    const { lot, winner } = await endedLot();

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'teste', ...(await confirmed(lot.id)) })).rejects.toMatchObject({ code: 'validation_error' });

    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await decisionsOf(lot.id)).toEqual([]);
  });

  it('refuses a lot that is already settled: its money was paid, not held', async () => {
    const { lot } = await endedLot();
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    await fetch(`${server.url}/api/lots/${lot.id}`);
    expect((await stateOf(lot.id))?.outcome).toBe('sold');
    await tamper(lot.id, 2);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'teste', ...(await confirmed(lot.id)) })).rejects.toMatchObject({ code: 'validation_error' });
    expect(await decisionsOf(lot.id)).toEqual([]);
  });

  it('refuses a second release of the same lot, so the money is never released twice', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'primeira', ...(await confirmed(lot.id)) });

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'segunda', ...(await confirmed(lot.id)) })).rejects.toMatchObject({ code: 'validation_error' });

    expect(await decisionsOf(lot.id)).toHaveLength(1);
    expect((await committedOf(winner))?.committed_cents).toBe(0);
  });

  it('stops the retries: the publisher never calls GitHub for a released lot, and the settlement never picks it', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'retirar', ...(await confirmed(lot.id)) });
    // The publisher takes only 20 lots a run, oldest first: leave this lot as the only one waiting, so it is the one it would reach.
    await server.db.query('update public.lots set anchored_seq = head_seq where id <> $1 and anchored_seq < head_seq', [lot.id]);
    const answer: StubAnswer = await recorded('get-missing');
    github.script(fileOf(lot.id), [answer, answer]);

    // The shared database holds other files' lots, so the answer of the whole run is not this test's to judge; the lot is.
    await fetch(`${server.url}/api/internal/close-due`, { method: 'POST', headers: { Authorization: `Bearer ${testConfig().cronSecret}` } });

    // The publisher checks the history before it reads GitHub, so a tampered lot never reaches GitHub either way: the sign that
    // the publisher retried it is its attempt counter, which must stay at zero for a released lot.
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
    const [progress] = await server.db.query<{ anchor_attempts: number; anchor_retry_at: Date | null }>('select anchor_attempts, anchor_retry_at from public.lots where id = $1', [lot.id]);
    expect(progress).toEqual({ anchor_attempts: 0, anchor_retry_at: null });
    expect((await stateOf(lot.id))?.status).toBe('integrity_cancelled');
    expect(await ledgerOf(lot.id)).toBe(0);
  });

  it('frees the amount the owner confirms from the bids, never an inflated copy: the wallet refuses what it does not cover', async () => {
    const { lot, winner } = await endedLot();
    // Only the first bid is altered, so the last bid still holds the 55,000 the winner committed.
    await tamper(lot.id, 1);
    // Someone rewrites the lot's amount to more than the winner committed.
    await server.db.query('update public.lots set current_amount_cents = 90000 where id = $1', [lot.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'teste', ...(await confirmed(lot.id)) })).rejects.toMatchObject({ code: 'internal_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });

    // The owner confirms the amount of the last stored bid: exactly what the winner committed.
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'confirmado', leaderId: winner.id, amountCents: 55_000 });
    expect((await committedOf(winner))?.committed_cents).toBe(0);
  });

  it('refuses to free money the leader committed on another lot it also leads, even when the owner confirms that leader', async () => {
    const { lot: other, winner: wallet } = await endedLot();
    const { lot, winner } = await endedLot();
    expect(winner.id).not.toBe(wallet.id);
    // The lot's copy is tampered to name `wallet` as leader with the same amount: the wallet leads `other` with 55,000.
    await server.db.query('update public.lots set leader_id = $2 where id = $1', [lot.id, wallet.id]);
    await tamper(lot.id, 2);
    expect((await committedOf(wallet))?.committed_cents).toBe(55_000);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'outro lote', leaderId: wallet.id, amountCents: 55_000 })).rejects.toMatchObject({ code: 'internal_error' });

    expect((await committedOf(wallet))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
    expect(await stateOf(other.id)).toMatchObject({ status: 'active' });
  });

  it('refuses a leader or an amount that neither the copy nor the last bid holds', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    const stranger = await bidder();

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'teste', leaderId: stranger.id, amountCents: 55_000 })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'teste', leaderId: winner.id, amountCents: 12_345 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
  });

  it('refuses a blank decider or reason, and a text longer than the record keeps', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    const who = await confirmed(lot.id);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: '  ', reason: 'x', ...who })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: '   ', ...who })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'a'.repeat(81), reason: 'x', ...who })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'r'.repeat(501), ...who })).rejects.toMatchObject({ code: 'validation_error' });
    expect(await decisionsOf(lot.id)).toEqual([]);
    // The longest texts the record keeps are accepted.
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'a'.repeat(80), reason: 'r'.repeat(500), ...who });
    expect(await decisionsOf(lot.id)).toHaveLength(1);
  });

  it('two releases of the same lot at the same moment: exactly one succeeds and the money is freed once', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    const who = await confirmed(lot.id);

    const outcomes = await Promise.allSettled([
      releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'um', ...who }),
      releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'dois', ...who }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect((await committedOf(winner))?.committed_cents).toBe(0);
    expect(await decisionsOf(lot.id)).toHaveLength(1);
  });

  it('a release that races a settlement of the same lot never pays it: the lot is freed or paid by exactly one of them', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    const who = await confirmed(lot.id);
    const before = await committedOf(winner);

    await Promise.allSettled([
      releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'corrida', ...who }),
      fetch(`${server.url}/api/lots/${lot.id}`),
    ]);

    expect(await ledgerOf(lot.id)).toBe(0);
    expect(await receiptsOf(lot.id)).toBe(0);
    expect(before?.total_cents).toBe((await committedOf(winner))?.total_cents);
  });

  it('frees only this lot amount when the same leader also leads another lot', async () => {
    const { lot, winner } = await endedLot();
    // The same winner leads a second lot, with its own committed money.
    const other = await endedLot(winner);
    expect((await committedOf(winner))?.committed_cents).toBe(110_000);
    await tamper(lot.id, 2);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'outro lote', ...(await confirmed(lot.id)) });

    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(other.lot.id)).toMatchObject({ status: 'active' });
  });

  it('the auctioneer sees a released lot as cancelled, not as live or ended', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'lista', ...(await confirmed(lot.id)) });

    const list = (await (await fetch(`${server.url}/api/auctioneer/lots`, { headers: json(auctioneer) })).json()) as { id: string; state: string }[];

    expect(list.find((row) => row.id === lot.id)?.state).toBe('cancelled');
  });

  it('releases a lot whose copy alone was altered: the chain verifies, settlement refuses it, and the owner confirms the bids', async () => {
    const { lot, winner } = await endedLot();
    // Only the lot's own copy of the amount changes; the bids and the head hash still verify.
    await server.db.query('update public.lots set current_amount_cents = 60000 where id = $1', [lot.id]);
    expect((await stateOf(lot.id))?.settled_at).toBeNull();
    await fetch(`${server.url}/api/lots/${lot.id}`);
    expect((await stateOf(lot.id))?.settled_at).toBeNull();

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'copia alterada', leaderId: winner.id, amountCents: 55_000 });

    expect((await committedOf(winner))?.committed_cents).toBe(0);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
  });

  it('a released lot whose chain verified is not published and not bid on: the status alone holds it', async () => {
    const { lot, winner } = await endedLot();
    await server.db.query('update public.lots set current_amount_cents = 60000 where id = $1', [lot.id]);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'copia', leaderId: winner.id, amountCents: 55_000 });
    // Leave this lot as the only one the publisher could reach: anything else waiting would hide what this test is about.
    await server.db.query('update public.lots set anchored_seq = head_seq where id <> $1 and anchored_seq < head_seq', [lot.id]);
    const late = await bidder();

    const placed = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(late), body: JSON.stringify({ amountCents: 90_000 }) });
    expect(placed.status).toBe(409);
    await fetch(`${server.url}/api/internal/close-due`, { method: 'POST', headers: { Authorization: `Bearer ${testConfig().cronSecret}` } });
    expect(github.requestsFor(fileOf(lot.id))).toEqual([]);
  });

  it('refuses a release while the lot time is still running, even when the lot is tampered', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    await server.db.query("update public.lots set ends_at = now() + interval '1 hour' where id = $1", [lot.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'no meio', leaderId: winner.id, amountCents: 55_000 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
  });

  it('checks the leader and the amount as one pair: a leader with zero, or no leader with an amount, is refused', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    // The copy has no amount (the owner may type 0 for it) and the last bid's leader is the winner: the pair (winner, 0) matches neither source.
    await server.db.query('update public.lots set current_amount_cents = null where id = $1', [lot.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'par', leaderId: winner.id, amountCents: 0 })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'par', leaderId: null, amountCents: 55_000 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('refuses a leader from one source with an amount from the other: the two belong to the same source, as one pair', async () => {
    const { lot, winner } = await endedLot();
    const other = await bidder();
    // The copy names `other` as leader with 55,000; the last bid is the winner's, altered to 1. Each value is in one source,
    // but the pair (other, 1) is in neither.
    await server.db.query('update public.lots set leader_id = $2 where id = $1', [lot.id, other.id]);
    await tamper(lot.id, 2);
    await server.db.query('update public.wallets set committed_cents = committed_cents + 55000 where user_id = $1', [other.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'mistura', leaderId: other.id, amountCents: 1 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(other))?.committed_cents).toBe(55_000);
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
  });

  it('refuses the empty pair when the bids are gone but the copy still names a leader: an empty release would free nothing and cancel the lot', async () => {
    const { lot, winner } = await endedLot();
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('delete from public.bids where lot_id = $1', [lot.id]);
      await tx.query('update public.lots set head_seq = 0, head_hash = null, bid_count = 0 where id = $1', [lot.id]);
    });

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'par vazio', leaderId: null, amountCents: 0 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('refuses the empty pair when the lot has bids: a copy that hides its leader does not free nothing into a cancelled lot', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    // The copy is altered to hide the leader and the amount; the bids say the winner committed 55,000.
    await server.db.query('update public.lots set leader_id = null, current_amount_cents = null where id = $1', [lot.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'copia escondida', leaderId: null, amountCents: 0 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('releases a lot whose bids were deleted and whose head was reset while its copy still names the leader: the money is not stuck', async () => {
    const { lot, winner } = await endedLot();
    // The bids are removed and the head reset, but the copy still says the winner leads with 55,000: settlement refuses this lot.
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('delete from public.bids where lot_id = $1', [lot.id]);
      await tx.query('update public.lots set head_seq = 0, head_hash = null, bid_count = 0 where id = $1', [lot.id]);
    });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'lances apagados', leaderId: winner.id, amountCents: 55_000 });

    expect((await committedOf(winner))?.committed_cents).toBe(0);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
  });

  it('releases a lot with no bids, no head count and no leader, but a head hash left behind: settlement refuses it, so the release must reach it', async () => {
    const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    const lot = (await created.json()) as OwnLot;
    made.push(lot.id);
    await server.db.query("update public.lots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute', head_hash = repeat('a', 64) where id = $1", [lot.id]);
    expect((await stateOf(lot.id))?.settled_at).toBeNull();

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'hash sobrando', leaderId: null, amountCents: 0 });

    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
  });

  it('refuses a lot with no bids and no head: there is no committed money to free, the settlement closes it', async () => {
    const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    const lot = (await created.json()) as OwnLot;
    made.push(lot.id);
    await server.db.query("update public.lots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute', current_amount_cents = 50000 where id = $1", [lot.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'sem lances', leaderId: null, amountCents: 0 })).rejects.toMatchObject({ code: 'validation_error' });
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('forbids truncating the decisions: the record is append-only for truncate too', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'truncar', ...(await confirmed(lot.id)) });

    await expect(server.db.query('truncate public.integrity_decisions')).rejects.toThrow();
    expect(await decisionsOf(lot.id)).toHaveLength(1);
  });

  it('keeps a lot with no leader unreleasable for money: no leader and zero is the only pair that frees nothing', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'nada', leaderId: null, amountCents: 0 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
  });

  it('a lot the script reads as released is hidden from the public lot page and its audit still answers', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'publico', leaderId: winner.id, amountCents: 55_000 });

    expect((await fetch(`${server.url}/api/lots/${lot.id}`)).status).toBe(404);
    expect((await fetch(`${server.url}/api/lots/${lot.id}/audit`)).status).toBe(200);
  });

  it('refuses a cancelled lot, even a tampered one: the release only frees the lots that are active', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    await server.db.query("update public.lots set status = 'cancelled' where id = $1", [lot.id]);

    await expect(releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'cancelado', leaderId: winner.id, amountCents: 55_000 })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
  });

  it('the decision keeps who was freed and how much, so the audit trail can say it', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'registro completo', leaderId: winner.id, amountCents: 55_000 });

    const [row] = await server.db.query<{ leader_id: string | null; released_cents: number }>('select leader_id, released_cents from public.integrity_decisions where lot_id = $1', [lot.id]);
    expect(row).toEqual({ leader_id: winner.id, released_cents: 55_000 });
  });

  it('releases a tampered lot whose winner already won a lot that settled: the settled lot holds no money, so it does not block the release', async () => {
    const { lot: settled, winner } = await endedLot();
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [settled.id]);
    await fetch(`${server.url}/api/lots/${settled.id}`);
    expect((await stateOf(settled.id))?.settled_at).not.toBeNull();
    const { lot } = await endedLot(winner);
    await tamper(lot.id, 2);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'vencedor já liquidou outro lote', leaderId: winner.id, amountCents: 55_000 });

    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
    expect((await committedOf(winner))?.committed_cents).toBe(0);
  });

  it('releases a second tampered lot of a winner whose first lot was released: the released lot holds no money, so it does not block the release', async () => {
    const { lot: first, winner } = await endedLot();
    await tamper(first.id, 2);
    await releaseTamperedLot(server.db, config, first.id, { decidedBy: 'owner', reason: 'primeiro lote', leaderId: winner.id, amountCents: 55_000 });
    const { lot: second } = await endedLot(winner);
    await tamper(second.id, 2);

    await releaseTamperedLot(server.db, config, second.id, { decidedBy: 'owner', reason: 'segundo lote', leaderId: winner.id, amountCents: 55_000 });

    expect(await stateOf(second.id)).toMatchObject({ status: 'integrity_cancelled' });
    expect((await committedOf(winner))?.committed_cents).toBe(0);
  });

  it('releases a lot whose copy alone names another leader while the chain verifies: the last bid holds the money, not the copy', async () => {
    const { lot, first, winner } = await endedLot();
    await server.db.query('update public.lots set leader_id = $2 where id = $1', [lot.id, first.id]);
    expect(await reviewTamperedLot(server.db, config, lot.id)).toMatchObject({ copyDisagrees: true, decidable: true, brokenAtSeq: null });

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'cópia com outro líder', leaderId: winner.id, amountCents: 55_000 });

    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
    expect((await committedOf(winner))?.committed_cents).toBe(0);
  });

  it('records a release above the 32-bit range: the decision keeps the whole amount, as money does everywhere else', async () => {
    const { lot, winner } = await endedLot();
    const big = 3_000_000_000;
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query('update public.lots set current_amount_cents = $2 where id = $1', [lot.id, big]);
      await tx.query('update public.wallets set total_cents = total_cents + $2, committed_cents = committed_cents + $2 where user_id = $1', [winner.id, big]);
    });

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'valor acima de 2^31', leaderId: winner.id, amountCents: big });

    const [row] = await server.db.query<{ released_cents: number }>('select released_cents from public.integrity_decisions where lot_id = $1', [lot.id]);
    expect(row?.released_cents).toBe(big);
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
  });

  it('a released lot does not raise the stale alert: the cron stays quiet for it after ten minutes', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'alerta', ...(await confirmed(lot.id)) });
    // Only this lot is left waiting, and its bid is older than the stale limit: if the release did not take it out of the count, the alert would fire.
    await server.db.query('update public.lots set anchored_seq = head_seq where id <> $1 and anchored_seq < head_seq', [lot.id]);
    await server.db.tx(async (tx) => {
      await tx.query('set local session_replication_role = replica');
      await tx.query("update public.bids set placed_at = now() - interval '30 minutes' where lot_id = $1", [lot.id]);
    });

    const run = await fetch(`${server.url}/api/internal/close-due`, { method: 'POST', headers: { Authorization: `Bearer ${testConfig().cronSecret}` } });
    const body = (await run.json()) as { anchor: { stale: number } };

    expect(body.anchor.stale).toBe(0);
    expect((await committedOf(winner))?.committed_cents).toBe(0);
  });

  it('checks the secret against an older sold lot when the newest sold lot was altered afterwards', async () => {
    const { lot: sold } = await endedLot();
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [sold.id]);
    await fetch(`${server.url}/api/lots/${sold.id}`);
    expect((await stateOf(sold.id))?.outcome).toBe('sold');
    // The newest sold lot is altered after the sale; an older healthy one still proves the secret.
    await tamper(sold.id, 1);
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'lei antiga', ...(await confirmed(lot.id)) });

    expect((await committedOf(winner))?.committed_cents).toBe(0);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
  });

  it('judges the lot under its lock: a holder that cancels the lot first makes the release refuse, and no money moves', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    const who = await confirmed(lot.id);
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    const locked = new Promise<void>((resolve) => {
      void server.db.tx(async (tx) => {
        await tx.query('select id from public.lots where id = $1 for update', [lot.id]);
        await tx.query("update public.lots set status = 'cancelled' where id = $1", [lot.id]);
        resolve();
        await held;
      });
    });
    await locked;
    let finished = false;
    const attempt = releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'trava', ...who }).then(() => { finished = true; }, () => { finished = 'refused' as unknown as boolean; });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(finished).toBe(false);
    letGo();
    await attempt;

    expect(finished).toBe('refused' as unknown as boolean);
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'cancelled' });
  });

  it('refuses an unknown lot without touching anything', async () => {
    await expect(releaseTamperedLot(server.db, config, randomUUID(), { decidedBy: 'owner', reason: 'teste', leaderId: null, amountCents: 0 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a bid on a released lot, even while the lot time is still running', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'retirar', ...(await confirmed(lot.id)) });
    await server.db.query('update public.lots set ends_at = now() + interval \'1 hour\' where id = $1', [lot.id]);
    const late = await bidder();

    const placed = await fetch(`${server.url}/api/lots/${lot.id}/bids`, { method: 'POST', headers: json(late), body: JSON.stringify({ amountCents: 90_000 }) });

    expect(placed.status).toBe(409);
    expect(((await placed.json()) as { code: string }).code).toBe('lot_cancelled');
  });

  it('keeps the decisions append-only: the database refuses to change or delete one', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    await releaseTamperedLot(server.db, config, lot.id, { decidedBy: 'owner', reason: 'registro', ...(await confirmed(lot.id)) });

    await expect(server.db.query('update public.integrity_decisions set reason = $2 where lot_id = $1', [lot.id, 'mudado'])).rejects.toThrow();
    await expect(server.db.query('delete from public.integrity_decisions where lot_id = $1', [lot.id])).rejects.toThrow();
    expect(await decisionsOf(lot.id)).toHaveLength(1);
  });
});

// The owner's script, run as a process with the answers on standard input: the same way the owner uses it.
const SCRIPT = fileURLToPath(new URL('../../scripts/release-lot.ts', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../', import.meta.url));
function runScript(lotId: string, answers: string, env: NodeJS.ProcessEnv = process.env): { status: number | null; out: string } {
  const run = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, lotId, 'dono', 'motivo do teste'], { cwd: BACKEND, input: answers, env, encoding: 'utf8' });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

/** Takes the settled lots away as a reference for the length of `run`, then gives them back. Other files run one at a time. */
async function withoutSoldLots<T>(run: () => T): Promise<T> {
  const taken = await server.db.query<{ id: string }>("update public.lots set outcome = 'no_bids' where outcome = 'sold' returning id");
  try {
    return await run();
  } finally {
    await server.db.query("update public.lots set outcome = 'sold' where id = any($1::uuid[])", [taken.map((row) => row.id)]);
  }
}

describe('the owner script: the answers, the refusals and the confirmation', () => {
  beforeAll(async () => {
    // A settled lot with bids, so the script has a reference to check the secret against.
    const { lot } = await endedLot();
    await server.db.query('update public.lots set anchored_seq = head_seq where id = $1', [lot.id]);
    await fetch(`${server.url}/api/lots/${lot.id}`);
    expect((await stateOf(lot.id))?.outcome).toBe('sold');
  });

  it('refuses an intact lot without asking anything, and writes nothing', async () => {
    const { lot, winner } = await endedLot();

    const run = runScript(lot.id, '');

    expect(run.status).toBe(1);
    expect(run.out).toContain('cadeia: sem quebra');
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('releases a tampered lot when the owner types the values and CONFIRMAR', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    const run = runScript(lot.id, `${winner.id}\n55000\nCONFIRMAR\n`);

    expect(run.status).toBe(0);
    expect(run.out).toContain('liberado:');
    expect((await committedOf(winner))?.committed_cents).toBe(0);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
  });

  it('writes nothing when the confirmation is not the exact word', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    const run = runScript(lot.id, `${winner.id}\n55000\nconfirmar\n`);

    expect(run.status).toBe(1);
    expect(run.out).toContain('nada foi gravado');
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('refuses an empty amount, never read as zero, and writes nothing', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    const run = runScript(lot.id, `${winner.id}\n\nCONFIRMAR\n`);

    expect(run.status).toBe(1);
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('refuses when the secret does not verify a settled lot: the lot is not the problem, the secret is', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    const run = runScript(lot.id, `${winner.id}\n55000\nCONFIRMAR\n`, { ...process.env, AUDIT_HMAC_SECRET: 'x'.repeat(40) });

    expect(run.status).toBe(1);
    expect(run.out).toContain('segredo');
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });
});

describe('the owner script without a settled lot to check the secret against', () => {
  it('asks for SEGREDO first, and refuses any other answer, writing nothing', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    const run = await withoutSoldLots(() => runScript(lot.id, `nao\n${winner.id}\n55000\nCONFIRMAR\n`));

    expect(run.status).toBe(1);
    expect(run.out).toContain('SEGREDO');
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });

  it('releases when the owner types SEGREDO, then the values and CONFIRMAR', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);

    const run = await withoutSoldLots(() => runScript(lot.id, `SEGREDO\n${winner.id}\n55000\nCONFIRMAR\n`));

    expect(run.status).toBe(0);
    expect((await committedOf(winner))?.committed_cents).toBe(0);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'integrity_cancelled' });
  });
});

describe('the release itself checks the secret against a settled lot, not only the script', () => {
  it('refuses to release with a wrong secret when a settled lot exists, under the lot lock, and writes nothing', async () => {
    const { lot, winner } = await endedLot();
    await tamper(lot.id, 2);
    const wrong: Config = { ...config, auditHmacSecret: 'x'.repeat(40) };

    await expect(releaseTamperedLot(server.db, wrong, lot.id, { decidedBy: 'owner', reason: 'segredo errado', ...(await confirmed(lot.id)) })).rejects.toMatchObject({ code: 'validation_error' });
    expect((await committedOf(winner))?.committed_cents).toBe(55_000);
    expect(await stateOf(lot.id)).toMatchObject({ status: 'active' });
  });
});

describe('reviewTamperedLot: what the owner is shown, and whether a release can be made', () => {
  it('returns nothing for a lot that does not exist', async () => {
    expect(await reviewTamperedLot(server.db, config, randomUUID())).toBeNull();
  });

  it('says a live lot cannot be released yet, and an active tampered lot can be once it has ended', async () => {
    const created = await fetch(`${server.url}/api/lots`, { method: 'POST', headers: json(auctioneer), body: JSON.stringify(lotBody(await dbNow(server))) });
    const live = (await created.json()) as OwnLot;
    made.push(live.id);
    await server.db.query("update public.lots set starts_at = now() - interval '5 minutes', ends_at = now() + interval '1 hour' where id = $1", [live.id]);
    expect((await reviewTamperedLot(server.db, config, live.id))?.reason).toBe('O lote ainda não encerrou.');

    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    const review = await reviewTamperedLot(server.db, config, lot.id);
    expect(review).toMatchObject({ status: 'active', brokenAtSeq: 2, decidable: true, reason: '' });
  });

  it('says an intact lot whose copy agrees has nothing to release, and a copy-only disagreement can be released', async () => {
    const { lot } = await endedLot();
    expect((await reviewTamperedLot(server.db, config, lot.id))?.reason).toBe('O histórico confere e a cópia confere com o último lance: não há o que liberar.');

    const other = await endedLot();
    await server.db.query('update public.lots set current_amount_cents = 60000 where id = $1', [other.lot.id]);
    expect(await reviewTamperedLot(server.db, config, other.lot.id)).toMatchObject({ brokenAtSeq: null, copyDisagrees: true, decidable: true });
  });

  it('reports the reference: verified with the secret in use, and broken with a wrong one', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    expect((await reviewTamperedLot(server.db, config, lot.id))?.reference).toBe('verified');

    const wrong: Config = { ...config, auditHmacSecret: 'x'.repeat(40) };
    const review = await reviewTamperedLot(server.db, wrong, lot.id);
    expect(review?.reference).toBe('broken');
    expect(review?.decidable).toBe(false);
    expect(review?.reason).toContain('segredo');
  });

  it('a lot that is already settled, or cancelled, is not releasable', async () => {
    const { lot } = await endedLot();
    await tamper(lot.id, 2);
    await server.db.query("update public.lots set status = 'cancelled' where id = $1", [lot.id]);

    expect((await reviewTamperedLot(server.db, config, lot.id))?.reason).toBe('O lote não está ativo e não liquidado.');
  });
});
