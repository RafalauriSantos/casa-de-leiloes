import { describe, expect, it } from 'vitest';
import { bidHash, genesisHash, pseudonymFor } from './chain';

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
