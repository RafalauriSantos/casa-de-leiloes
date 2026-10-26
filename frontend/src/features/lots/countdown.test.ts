import { describe, expect, it } from 'vitest';
import { formatRemaining } from './time';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRemaining: the countdown reads in days when there are more than a day left', () => {
  it('shows hours, minutes and seconds under a day', () => {
    expect(formatRemaining(HOUR + 2 * MINUTE + 3_000)).toBe('01:02:03');
    expect(formatRemaining(DAY - 1_000)).toBe('23:59:59');
  });

  it('shows days and then hours, minutes and seconds from one day on', () => {
    expect(formatRemaining(DAY)).toBe('1 dia 00:00:00');
    expect(formatRemaining(DAY + HOUR + 2 * MINUTE + 3_000)).toBe('1 dia 01:02:03');
    expect(formatRemaining(30 * DAY - 4 * MINUTE)).toBe('29 dias 23:56:00');
  });

  it('says a lot is over at zero or below', () => {
    expect(formatRemaining(0)).toBe('encerrado');
    expect(formatRemaining(-5_000)).toBe('encerrado');
  });
});
