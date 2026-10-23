import { describe, expect, it } from 'vitest';
import { DEPOSIT_MAX_CENTS, DEPOSIT_MIN_CENTS } from '@casa/contracts';
import { availableCents, checkDeposit } from './rules';

describe('availableCents', () => {
  it('is total minus committed', () => {
    expect(availableCents({ totalCents: 10_000, committedCents: 2_500 })).toBe(7_500);
  });

  it('is zero when everything is committed', () => {
    expect(availableCents({ totalCents: 500, committedCents: 500 })).toBe(0);
  });

  it('refuses a wallet that violates the invariant instead of reporting a negative balance', () => {
    expect(() => availableCents({ totalCents: 100, committedCents: 101 })).toThrow('invariant');
  });
});

describe('checkDeposit', () => {
  it('accepts the limits', () => {
    expect(checkDeposit(DEPOSIT_MIN_CENTS)).toBeUndefined();
    expect(checkDeposit(DEPOSIT_MAX_CENTS)).toBeUndefined();
  });

  it.each([0, -100, DEPOSIT_MIN_CENTS - 1, DEPOSIT_MAX_CENTS + 1])('refuses %i with a reason', (amount) => {
    expect(checkDeposit(amount)).toEqual(expect.any(String));
  });

  it('mentions the limits in the reason', () => {
    expect(checkDeposit(DEPOSIT_MAX_CENTS + 1)).toContain('100.000,00');
    expect(checkDeposit(DEPOSIT_MIN_CENTS - 1)).toContain('1,00');
  });
});
