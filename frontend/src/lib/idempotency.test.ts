import { describe, expect, it } from 'vitest';
import { intentFor } from './idempotency';

describe('intentFor', () => {
  it('creates a key for the first attempt', () => {
    expect(intentFor(undefined, 5_000, () => 'k1')).toEqual({ cents: 5_000, key: 'k1' });
  });

  it('keeps the key when the same amount is retried, so a retry can never credit twice', () => {
    const first = intentFor(undefined, 5_000, () => 'k1');
    expect(intentFor(first, 5_000, () => 'k2')).toBe(first);
  });

  it('creates a new key when the amount changes, because it is a new intent', () => {
    const first = intentFor(undefined, 5_000, () => 'k1');
    expect(intentFor(first, 9_000, () => 'k2')).toEqual({ cents: 9_000, key: 'k2' });
  });
});
