import { describe, expect, it } from 'vitest';
import { clockOffset, remainingMs } from './time';

// Criterion 4.9: the countdown uses the server's clock, not the browser's.
describe('the countdown follows the server clock (4.9)', () => {
  const serverNow = Date.parse('2026-10-26T12:00:00Z');
  const endsAt = '2026-10-26T12:10:00Z';

  it('measures the offset from the server time and the moment the reply was sent and received', () => {
    // The browser sent at 11:59:59.000 and received at 12:00:01.000 (2 s round trip): the server read its clock
    // at about the midpoint, 12:00:00.000, so the browser clock is exact here.
    const sentAt = Date.parse('2026-10-26T11:59:59Z');
    const receivedAt = Date.parse('2026-10-26T12:00:01Z');
    expect(clockOffset(new Date(serverNow).toISOString(), sentAt, receivedAt)).toBe(0);
  });

  it('keeps the countdown right when the browser clock is an hour off', () => {
    const browserNow = serverNow - 60 * 60_000; // the browser runs one hour behind the server
    const offset = clockOffset(new Date(serverNow).toISOString(), browserNow - 1_000, browserNow + 1_000);
    expect(remainingMs(endsAt, offset, browserNow)).toBe(10 * 60_000);
  });

  it('is zero or negative once the server says the lot has ended, whatever the browser clock says', () => {
    const offset = clockOffset(new Date(serverNow).toISOString(), serverNow - 1_000, serverNow + 1_000);
    expect(remainingMs(endsAt, offset, serverNow + 11 * 60_000)).toBeLessThanOrEqual(0);
  });
});
