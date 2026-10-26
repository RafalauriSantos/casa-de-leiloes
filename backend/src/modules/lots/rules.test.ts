import { describe, expect, it } from 'vitest';
import { cancelRefusal, checkTiming, editRefusal, MIN_DURATION_MS, stateOf } from './rules';

const at = (ms: number) => new Date(Date.UTC(2030, 0, 1, 12, 0, 0) + ms);
const now = at(0);

describe('stateOf (inclusive start, exclusive end)', () => {
  const lot = { startsAt: at(1000), endsAt: at(5000), cancelled: false };

  it('is scheduled before the start', () => {
    expect(stateOf(lot, at(999))).toBe('scheduled');
  });

  it('is live exactly at the start', () => {
    expect(stateOf(lot, at(1000))).toBe('live');
  });

  it('is live one millisecond before the end', () => {
    expect(stateOf(lot, at(4999))).toBe('live');
  });

  it('has ended exactly at the end', () => {
    expect(stateOf(lot, at(5000))).toBe('ended');
  });

  it('is cancelled whatever the time, when cancelled', () => {
    expect(stateOf({ ...lot, cancelled: true }, at(2000))).toBe('cancelled');
  });
});

describe('checkTiming', () => {
  it('accepts a lot that starts in the future and lasts exactly the minimum', () => {
    expect(checkTiming(at(1), at(1 + MIN_DURATION_MS), now)).toBeUndefined();
  });

  it('refuses an end at or before the start', () => {
    expect(checkTiming(at(10), at(10), now)).toMatch(/fim/);
    expect(checkTiming(at(10), at(5), now)).toMatch(/fim/);
  });

  it('refuses a lot shorter than the minimum', () => {
    expect(checkTiming(at(10), at(10 + MIN_DURATION_MS - 1), now)).toMatch(/1 minuto/);
  });

  it('refuses a start that is not in the future, including exactly now', () => {
    expect(checkTiming(now, at(MIN_DURATION_MS), now)).toMatch(/futuro/);
    expect(checkTiming(at(-1), at(MIN_DURATION_MS), now)).toMatch(/futuro/);
  });
});

describe('edit and cancel rules', () => {
  it('allows editing only a scheduled lot without bids', () => {
    expect(editRefusal({ state: 'scheduled', bidCount: 0 })).toBeUndefined();
    expect(editRefusal({ state: 'scheduled', bidCount: 1 })).toEqual({ code: 'lot_not_editable', message: expect.any(String) as string });
    expect(editRefusal({ state: 'live', bidCount: 0 })?.code).toBe('lot_not_editable');
    expect(editRefusal({ state: 'ended', bidCount: 0 })?.code).toBe('lot_ended');
    expect(editRefusal({ state: 'cancelled', bidCount: 0 })?.code).toBe('lot_not_editable');
  });

  it('allows cancelling a scheduled or live lot, with or without bids, but not an ended or cancelled one', () => {
    expect(cancelRefusal({ state: 'scheduled' })).toBeUndefined();
    expect(cancelRefusal({ state: 'live' })).toBeUndefined();
    expect(cancelRefusal({ state: 'ended' })?.code).toBe('lot_ended');
    expect(cancelRefusal({ state: 'cancelled' })?.code).toBe('lot_not_editable');
  });
});
