import { MAX_BIDS_PER_LOT } from '@casa/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_ANCHOR_FILE_BYTES } from './file';
import { ANCHOR_HEADER, anchorLine, isStalePending, retryDelayMs, seqsToPublish, STALE_PENDING_MS } from './rules';

describe('ANCHOR_HEADER', () => {
  it('names the four columns of every anchor line', () => {
    expect(ANCHOR_HEADER).toBe('lot_id,seq,head_hash,published_at');
  });
});

describe('anchorLine', () => {
  it('writes lot, sequence number, hash and time, comma separated', () => {
    const hash = 'ab'.repeat(32);
    expect(anchorLine({ lotId: 'lot-1', seq: 3, hash, publishedAt: '2026-10-24T18:00:00.000Z' })).toBe(`lot-1,3,${hash},2026-10-24T18:00:00.000Z`);
  });
});

describe('seqsToPublish', () => {
  it('lists the sequence numbers after the anchored one, up to the head', () => {
    expect(seqsToPublish(0, 3)).toEqual([1, 2, 3]);
    expect(seqsToPublish(2, 5)).toEqual([3, 4, 5]);
  });

  it('is empty when everything is anchored', () => {
    expect(seqsToPublish(4, 4)).toEqual([]);
  });

  it('is empty when the anchor is somehow ahead of the head', () => {
    expect(seqsToPublish(5, 3)).toEqual([]);
  });

  it('is empty when the lot has no bids', () => {
    expect(seqsToPublish(0, 0)).toEqual([]);
  });
});

describe('retryDelayMs', () => {
  it('waits nothing before the first attempt, or for a value that is not a count', () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(-3)).toBe(0);
    expect(retryDelayMs(Number.NaN)).toBe(0);
  });

  it('doubles from one minute after each failure', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
  });

  it('never waits more than fifteen minutes', () => {
    expect(retryDelayMs(5)).toBe(900_000);
    expect(retryDelayMs(50)).toBe(900_000);
    expect(retryDelayMs(10_000)).toBe(900_000);
  });
});

describe('isStalePending', () => {
  it('limits a pending head to 10 minutes', () => {
    expect(STALE_PENDING_MS).toBe(600_000);
  });

  it('is not an incident just before the limit', () => {
    expect(isStalePending(0, STALE_PENDING_MS - 1)).toBe(false);
  });

  it('is an incident at the limit and after it', () => {
    expect(isStalePending(0, STALE_PENDING_MS)).toBe(true);
    expect(isStalePending(0, STALE_PENDING_MS + 1)).toBe(true);
  });
});

describe('the bid limit keeps every lot publishable (D23)', () => {
  it('fits the anchor file of a full lot, with the longest line, in less than a quarter of what the publisher accepts', () => {
    const longest = anchorLine({ lotId: '11111111-1111-4111-8111-111111111111', seq: MAX_BIDS_PER_LOT, hash: 'f'.repeat(64), publishedAt: '2030-12-31T23:59:59.999Z' });
    const bytes = Buffer.byteLength(ANCHOR_HEADER, 'utf8') + 1 + MAX_BIDS_PER_LOT * (Buffer.byteLength(longest, 'utf8') + 1);

    expect(bytes).toBeLessThan(MAX_ANCHOR_FILE_BYTES / 4);
  });
});
