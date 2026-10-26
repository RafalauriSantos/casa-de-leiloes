import { describe, expect, it } from 'vitest';
import { isReceiptCode, outcomeOf } from './rules';

const NOW = new Date('2030-01-01T12:00:00Z');
const BEFORE_END = new Date(NOW.getTime() + 60_000);
const AFTER_END = new Date(NOW.getTime() - 60_000);
const ME = 'bidder-me';
const OTHER = 'bidder-other';

describe('outcomeOf: where a bidder stands in a lot', () => {
  it('is won when a receipt exists for the bidder, whatever the lot status says', () => {
    expect(outcomeOf({ status: 'active', leaderId: OTHER, endsAt: AFTER_END, receiptCode: 'a'.repeat(32) }, ME, NOW)).toBe('won');
  });

  it('is cancelled for a lot that is not active (cancelled or released), before any other check', () => {
    expect(outcomeOf({ status: 'cancelled', leaderId: ME, endsAt: BEFORE_END, receiptCode: null }, ME, NOW)).toBe('cancelled');
    expect(outcomeOf({ status: 'integrity_cancelled', leaderId: ME, endsAt: AFTER_END, receiptCode: null }, ME, NOW)).toBe('cancelled');
  });

  it('is leading while the lot runs with the bidder in the lead', () => {
    expect(outcomeOf({ status: 'active', leaderId: ME, endsAt: BEFORE_END, receiptCode: null }, ME, NOW)).toBe('leading');
  });

  it('is settling when the bidder led at the end and the receipt is not written yet, never leading', () => {
    expect(outcomeOf({ status: 'active', leaderId: ME, endsAt: AFTER_END, receiptCode: null }, ME, NOW)).toBe('settling');
  });

  it('is outbid while the lot runs and the bidder no longer leads', () => {
    expect(outcomeOf({ status: 'active', leaderId: OTHER, endsAt: BEFORE_END, receiptCode: null }, ME, NOW)).toBe('outbid');
  });

  it('is lost once the lot has ended, the bidder is not leading and there is no receipt', () => {
    expect(outcomeOf({ status: 'active', leaderId: OTHER, endsAt: AFTER_END, receiptCode: null }, ME, NOW)).toBe('lost');
  });

  it('treats the exact end instant as ended: the end is exclusive', () => {
    expect(outcomeOf({ status: 'active', leaderId: OTHER, endsAt: NOW, receiptCode: null }, ME, NOW)).toBe('lost');
    expect(outcomeOf({ status: 'active', leaderId: OTHER, endsAt: new Date(NOW.getTime() + 1), receiptCode: null }, ME, NOW)).toBe('outbid');
  });
});

describe('isReceiptCode: only 32 lowercase hex characters', () => {
  it('accepts the shape the receipts table stores', () => {
    expect(isReceiptCode('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it('refuses a wrong length, uppercase, or anything that is not hex', () => {
    expect(isReceiptCode('0123456789abcdef')).toBe(false);
    expect(isReceiptCode('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
    expect(isReceiptCode('0123456789abcdef0123456789abcdeg')).toBe(false);
    expect(isReceiptCode('')).toBe(false);
  });
});
