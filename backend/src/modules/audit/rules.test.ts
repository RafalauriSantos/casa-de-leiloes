import { describe, expect, it } from 'vitest';
import { chainResult, compareWithAnchor, truncateToSecond } from './rules';

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

describe('compareWithAnchor: the file of the anchor against the history', () => {
  const NOW = 60 * 60_000;
  const bids = (count: number, placedAtMs = NOW) => Array.from({ length: count }, (_, index) => ({ seq: index + 1, hash: `h${String(index + 1)}`, placedAtMs }));
  const held = (...seqs: number[]) => new Map(seqs.map((seq) => [seq, `h${String(seq)}`]));

  it('is published when every bid is in the file with its hash, and for a lot with no bids and no lines', () => {
    expect(compareWithAnchor(bids(3), { held: held(1, 2, 3), anchoredSeq: 3 }, NOW)).toEqual({ status: 'published', publishedThroughSeq: 3 });
    expect(compareWithAnchor([], { held: new Map(), anchoredSeq: 0 }, NOW)).toEqual({ status: 'published', publishedThroughSeq: 0 });
  });

  it('is pending when the file lacks only the latest bids, with no file at all as the first case', () => {
    expect(compareWithAnchor(bids(3), { held: held(1), anchoredSeq: 1 }, NOW)).toEqual({ status: 'pending', publishedThroughSeq: 1, stale: false });
    expect(compareWithAnchor(bids(2), { held: new Map(), anchoredSeq: 0 }, NOW)).toEqual({ status: 'pending', publishedThroughSeq: 0, stale: false });
  });

  it('says stale only when the oldest unpublished bid has waited 10 minutes', () => {
    const waited = (ms: number) => compareWithAnchor(bids(2, NOW - ms), { held: held(1), anchoredSeq: 1 }, NOW);
    expect(waited(10 * 60_000 - 1)).toMatchObject({ status: 'pending', stale: false });
    expect(waited(10 * 60_000)).toMatchObject({ status: 'pending', stale: true });
  });

  it('is divergent at the first seq of a bid the history does not have (the last bid was removed after it was published)', () => {
    expect(compareWithAnchor(bids(2), { held: held(1, 2, 3), anchoredSeq: 3 }, NOW)).toEqual({ status: 'divergent', atSeq: 3 });
    expect(compareWithAnchor([], { held: held(1), anchoredSeq: 1 }, NOW)).toEqual({ status: 'divergent', atSeq: 1 });
  });

  it('is divergent at a bid whose hash differs', () => {
    const changed = new Map([[1, 'h1'], [2, 'other']]);
    expect(compareWithAnchor(bids(3), { held: changed, anchoredSeq: 2 }, NOW)).toEqual({ status: 'divergent', atSeq: 2 });
  });

  it('is divergent at a bid the lot says was published but the file lacks, including a missing file', () => {
    expect(compareWithAnchor(bids(3), { held: held(1), anchoredSeq: 2 }, NOW)).toEqual({ status: 'divergent', atSeq: 2 });
    expect(compareWithAnchor(bids(1), { held: new Map(), anchoredSeq: 1 }, NOW)).toEqual({ status: 'divergent', atSeq: 1 });
  });

  it('is divergent at a bid the file skips above anchored_seq: the publisher never writes that', () => {
    expect(compareWithAnchor(bids(3), { held: held(1, 3), anchoredSeq: 1 }, NOW)).toEqual({ status: 'divergent', atSeq: 2 });
    expect(compareWithAnchor(bids(3), { held: held(1, 3), anchoredSeq: 3 }, NOW)).toEqual({ status: 'divergent', atSeq: 2 });
  });

  it('names the lowest seq when there is more than one problem', () => {
    const mixed = new Map([[1, 'h1'], [2, 'other'], [4, 'h4']]);
    expect(compareWithAnchor(bids(3), { held: mixed, anchoredSeq: 1 }, NOW)).toEqual({ status: 'divergent', atSeq: 2 });
  });
});
