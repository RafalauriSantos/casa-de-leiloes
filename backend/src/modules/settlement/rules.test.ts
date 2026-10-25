import { describe, expect, it } from 'vitest';
import { isDue, mustWaitForAnchor } from './rules';

describe('isDue: a lot is due at its end time, and not before', () => {
  it('is not due one millisecond before the end and is due at the end', () => {
    const endsAt = new Date('2030-01-01T12:00:00.000Z');
    expect(isDue(endsAt, new Date(endsAt.getTime() - 1))).toBe(false);
    expect(isDue(endsAt, endsAt)).toBe(true);
  });
});

describe('mustWaitForAnchor: money never moves on a bid whose hash is not in the public anchor (D21, option B)', () => {
  it('waits while the publisher has not reached the last bid', () => {
    expect(mustWaitForAnchor({ anchorMode: 'github', anchoredSeq: 0, headSeq: 3 })).toBe(true);
    expect(mustWaitForAnchor({ anchorMode: 'github', anchoredSeq: 2, headSeq: 3 })).toBe(true);
  });

  it('does not wait once the last bid is published', () => {
    expect(mustWaitForAnchor({ anchorMode: 'github', anchoredSeq: 3, headSeq: 3 })).toBe(false);
  });

  it('does not wait when the lot has no bids: there is nothing to publish', () => {
    expect(mustWaitForAnchor({ anchorMode: 'github', anchoredSeq: 0, headSeq: 0 })).toBe(false);
  });

  it('does not wait when the anchor is off (preview and local runs have no public anchor)', () => {
    expect(mustWaitForAnchor({ anchorMode: 'off', anchoredSeq: 0, headSeq: 3 })).toBe(false);
  });

  it('waits only when anchoredSeq is below headSeq: a counter above the head does not wait (guards the comparison against !==)', () => {
    expect(mustWaitForAnchor({ anchorMode: 'github', anchoredSeq: 4, headSeq: 3 })).toBe(false);
  });
});
