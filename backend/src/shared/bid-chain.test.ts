import { describe, expect, it } from 'vitest';
import { bidHash, firstBrokenSeq, genesisHash, pseudonymFor, type StoredBid } from './bid-chain';

const SECRET = 'a'.repeat(32);
const LOT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const base = { lotId: LOT, seq: 1, bidderId: USER, amountCents: 50_000, placedAt: new Date('2030-01-01T12:00:00.000Z') };
const genesis = genesisHash(SECRET, LOT);

describe('bid hash chain', () => {
  it('is 64 hex characters and deterministic', () => {
    const hash = bidHash(SECRET, { ...base, prevHash: genesis });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bidHash(SECRET, { ...base, prevHash: genesis })).toBe(hash);
  });

  it('changes when any field changes: amount, bidder, time, sequence, lot, previous hash', () => {
    const reference = bidHash(SECRET, { ...base, prevHash: genesis });
    const changes = [
      { amountCents: 50_001 },
      { bidderId: '33333333-3333-4333-8333-333333333333' },
      { placedAt: new Date('2030-01-01T12:00:00.001Z') },
      { seq: 2 },
      { lotId: '44444444-4444-4444-8444-444444444444' },
      { prevHash: 'b'.repeat(64) },
    ];
    for (const change of changes) {
      expect(bidHash(SECRET, { ...base, prevHash: genesis, ...change })).not.toBe(reference);
    }
  });

  it('depends on the secret: without it nobody can produce a valid hash', () => {
    expect(bidHash('b'.repeat(32), { ...base, prevHash: genesis })).not.toBe(bidHash(SECRET, { ...base, prevHash: genesis }));
  });

  it('gives each lot its own genesis, so a bid cannot be copied into another lot', () => {
    expect(genesisHash(SECRET, LOT)).not.toBe(genesisHash(SECRET, '44444444-4444-4444-8444-444444444444'));
  });
});

describe('pseudonyms (privacy: stable inside a lot, different across lots, never the user id)', () => {
  it('is the same for the same user in the same lot', () => {
    expect(pseudonymFor(SECRET, LOT, USER)).toBe(pseudonymFor(SECRET, LOT, USER));
  });

  it('differs between lots for the same user', () => {
    expect(pseudonymFor(SECRET, LOT, USER)).not.toBe(pseudonymFor(SECRET, '44444444-4444-4444-8444-444444444444', USER));
  });

  it('never contains the user id', () => {
    expect(pseudonymFor(SECRET, LOT, USER)).not.toContain(USER.replace(/-/g, '').slice(0, 8));
    expect(pseudonymFor(SECRET, LOT, USER)).toMatch(/^[0-9a-f]{12}$/);
  });
});

/** A valid history of `count` bids, each by the same bidder, one minute apart. */
function history(count: number): StoredBid[] {
  const bids: StoredBid[] = [];
  let prevHash = genesis;
  for (let seq = 1; seq <= count; seq += 1) {
    const bid = { lotId: LOT, seq, bidderId: USER, amountCents: 50_000 + seq * 5_000, placedAt: new Date(Date.UTC(2030, 0, 1, 12, seq)), prevHash };
    const stored = { ...bid, hash: bidHash(SECRET, bid) };
    bids.push(stored);
    prevHash = stored.hash;
  }
  return bids;
}

/** The bid at an index, or a failed test: no non-null assertion in test code. */
function bidAt(bids: StoredBid[], index: number): StoredBid {
  const bid = bids[index];
  if (!bid) throw new Error(`no bid at index ${String(index)}`);
  return bid;
}

const headOf = (bids: StoredBid[]) => ({ seq: bids.at(-1)?.seq ?? 0, hash: bids.at(-1)?.hash ?? null });
const broken = (bids: StoredBid[], head = headOf(bids)) => firstBrokenSeq(SECRET, LOT, bids, head);

describe('firstBrokenSeq: the lowest seq where the history and the lot head copy disagree or the chain fails', () => {
  it('is null for an intact history, including an empty one with an empty head', () => {
    expect(broken(history(5))).toBeNull();
    expect(broken([], { seq: 0, hash: null })).toBeNull();
  });

  it('names the edited bid: amount, bidder and time each give its seq', () => {
    for (const change of [{ amountCents: 1 }, { bidderId: '33333333-3333-4333-8333-333333333333' }, { placedAt: new Date('2030-02-01T00:00:00.000Z') }]) {
      const bids = history(5);
      bids[2] = { ...bidAt(bids, 2), ...change };
      expect(broken(bids, headOf(history(5)))).toBe(3);
    }
  });

  it('names the seq expected at a gap: bids 1, 2, 4 give 3', () => {
    const bids = history(4).filter((bid) => bid.seq !== 3);
    expect(broken(bids, headOf(history(4)))).toBe(3);
  });

  it('names the first of two swapped bids', () => {
    const bids = history(4);
    const second = bidAt(bids, 1);
    bids[1] = bidAt(bids, 2);
    bids[2] = second;
    expect(broken(bids, headOf(history(4)))).toBe(2);
  });

  it('names an inserted bid that has no valid hash', () => {
    const bids = history(3);
    const forged = { ...bidAt(bids, 1), seq: 2, amountCents: 99_999 };
    bids.splice(1, 0, forged);
    expect(broken(bids, headOf(history(3)))).toBe(2);
  });

  it('names a bid whose previous hash is not the hash before it (its stored hash then fails too)', () => {
    const bids = history(4);
    bids[3] = { ...bidAt(bids, 3), prevHash: 'c'.repeat(64) };
    expect(broken(bids, headOf(history(4)))).toBe(4);
  });

  it('names a bid that links to the wrong hash even when its own hash recomputes (only the link check can see it)', () => {
    const bids = history(4);
    const relinked = { ...bidAt(bids, 2), prevHash: 'c'.repeat(64) };
    bids[2] = { ...relinked, hash: bidHash(SECRET, relinked) };
    expect(broken(bids, headOf(history(4)))).toBe(3);
  });

  it('names a gap in the numbers even when links and hashes are consistent (only the seq check can see it)', () => {
    const bids = history(2);
    const skipped = { lotId: LOT, seq: 4, bidderId: USER, amountCents: 70_000, placedAt: new Date(Date.UTC(2030, 0, 1, 12, 4)), prevHash: bidAt(bids, 1).hash };
    bids.push({ ...skipped, hash: bidHash(SECRET, skipped) });
    expect(broken(bids, { seq: 4, hash: bidAt(bids, 2).hash })).toBe(3);
  });

  it('names a first bid that does not link to the lot genesis', () => {
    const bids = history(3);
    bids[0] = { ...bidAt(bids, 0), prevHash: genesisHash(SECRET, '44444444-4444-4444-8444-444444444444') };
    expect(broken(bids, headOf(history(3)))).toBe(1);
  });

  it('is the first missing seq when bids are removed and the head copy still says they exist', () => {
    expect(broken(history(4), { seq: 5, hash: bidAt(history(5), 4).hash })).toBe(5);
    expect(broken(history(2), { seq: 5, hash: bidAt(history(5), 4).hash })).toBe(3);
    expect(broken([], { seq: 5, hash: bidAt(history(5), 4).hash })).toBe(1);
  });

  it('is the seq after the head copy when the history holds more bids than the copy says', () => {
    expect(broken(history(5), { seq: 3, hash: bidAt(history(5), 2).hash })).toBe(4);
    expect(broken(history(2), { seq: 0, hash: null })).toBe(1);
  });

  it('is the head_seq when the seq matches and the hash does not', () => {
    expect(broken(history(4), { seq: 4, hash: 'd'.repeat(64) })).toBe(4);
    expect(broken(history(4), { seq: 4, hash: null })).toBe(4);
  });

  it('gives the lower of a chain break and a head copy break', () => {
    const bids = history(5);
    bids[4] = { ...bidAt(bids, 4), amountCents: 1 };
    expect(broken(bids, { seq: 3, hash: bidAt(history(5), 2).hash })).toBe(4);
    expect(broken(bids, headOf(history(5)))).toBe(5);
  });

  it('is a head break of 1 for an empty history with a head hash but no seq', () => {
    expect(broken([], { seq: 0, hash: 'e'.repeat(64) })).toBe(1);
  });
});
