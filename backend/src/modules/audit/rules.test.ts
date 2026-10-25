import { describe, expect, it } from 'vitest';
import { chainResult, truncateToSecond } from './rules';

describe('audit rules', () => {
  it('truncates a time to the second, never rounding up (D10)', () => {
    expect(truncateToSecond('2030-01-01T12:00:00.000Z')).toBe('2030-01-01T12:00:00Z');
    expect(truncateToSecond('2030-01-01T12:00:59.999Z')).toBe('2030-01-01T12:00:59Z');
  });

  it('says intact for no broken seq, and tampered with the seq otherwise', () => {
    expect(chainResult(null)).toEqual({ status: 'intact' });
    expect(chainResult(3)).toEqual({ status: 'tampered', brokenAtSeq: 3 });
    expect(chainResult(1)).toEqual({ status: 'tampered', brokenAtSeq: 1 });
  });
});
