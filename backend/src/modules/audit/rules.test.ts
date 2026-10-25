import { describe, expect, it } from 'vitest';
import type { AnchorResult, ChainResult, ReceiptHeadResult } from '@casa/contracts';
import { chainResult, compareWithAnchor, headlineOf, receiptHeadResult, truncateToSecond } from './rules';

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

describe('receiptHeadResult: is the head a bidder kept the hash of one of the bids?', () => {
  const bids = [{ seq: 1, hash: 'h1' }, { seq: 2, hash: 'h2' }];

  it('finds the seq of the bid whose hash it is', () => {
    expect(receiptHeadResult(bids, 'h2')).toEqual({ status: 'in_history', seq: 2 });
    expect(receiptHeadResult(bids, 'h1')).toEqual({ status: 'in_history', seq: 1 });
  });

  it('does not find a head that is not the hash of any bid, including any head for a lot with no bids', () => {
    expect(receiptHeadResult(bids, 'h3')).toEqual({ status: 'not_in_history' });
    expect(receiptHeadResult([], 'h1')).toEqual({ status: 'not_in_history' });
  });
});

describe('headlineOf: what the page may say, in the order of D22', () => {
  const intact: ChainResult = { status: 'intact' };
  const tampered: ChainResult = { status: 'tampered', brokenAtSeq: 2 };
  const published: AnchorResult = { status: 'published', publishedThroughSeq: 3 };
  const pending: AnchorResult = { status: 'pending', publishedThroughSeq: 1, stale: false };
  const divergent: AnchorResult = { status: 'divergent', atSeq: 2 };
  const unavailable: AnchorResult = { status: 'unavailable' };
  const off: AnchorResult = { status: 'off' };
  const found: ReceiptHeadResult = { status: 'in_history', seq: 3 };
  const notFound: ReceiptHeadResult = { status: 'not_in_history' };

  it('(1) is tampered when the chain is tampered or the anchor is divergent, whatever the receipt says', () => {
    for (const receipt of [undefined, found, notFound]) {
      expect(headlineOf({ chain: tampered, anchor: published, receiptHead: receipt, bidCount: 3 })).toEqual({ kind: 'tampered' });
      expect(headlineOf({ chain: intact, anchor: divergent, receiptHead: receipt, bidCount: 3 })).toEqual({ kind: 'tampered' });
    }
    expect(headlineOf({ chain: tampered, anchor: divergent, receiptHead: undefined, bidCount: 0 })).toEqual({ kind: 'tampered' });
  });

  it('(2) is unconfirmed, never tampered, when a head was sent and not found', () => {
    expect(headlineOf({ chain: intact, anchor: published, receiptHead: notFound, bidCount: 3 })).toEqual({ kind: 'unconfirmed' });
    expect(headlineOf({ chain: intact, anchor: unavailable, receiptHead: notFound, bidCount: 3 })).toEqual({ kind: 'unconfirmed' });
    expect(headlineOf({ chain: intact, anchor: published, receiptHead: notFound, bidCount: 0 })).toEqual({ kind: 'unconfirmed' });
  });

  it('(3) says there are no bids, and that the anchor was not verified when it could not be read or is off', () => {
    expect(headlineOf({ chain: intact, anchor: published, receiptHead: undefined, bidCount: 0 })).toEqual({ kind: 'no_bids', anchorUnverified: false });
    expect(headlineOf({ chain: intact, anchor: unavailable, receiptHead: undefined, bidCount: 0 })).toEqual({ kind: 'no_bids', anchorUnverified: true });
    expect(headlineOf({ chain: intact, anchor: off, receiptHead: undefined, bidCount: 0 })).toEqual({ kind: 'no_bids', anchorUnverified: true });
  });

  it('(4) is intact only up to the seq of a receipt that was found, with the anchor published', () => {
    expect(headlineOf({ chain: intact, anchor: published, receiptHead: found, bidCount: 3 })).toEqual({ kind: 'intact_until', seq: 3 });
  });

  it('(4) says the chain only, with how far the anchor goes, when a receipt was found and the anchor is pending', () => {
    expect(headlineOf({ chain: intact, anchor: pending, receiptHead: found, bidCount: 3 })).toEqual({ kind: 'intact_chain_until', seq: 3, publishedThroughSeq: 1 });
  });

  it('(5) says no divergence through the last published bid when no head was sent, and never intact', () => {
    expect(headlineOf({ chain: intact, anchor: published, receiptHead: undefined, bidCount: 3 })).toEqual({ kind: 'no_divergence_until', publishedThroughSeq: 3 });
    expect(headlineOf({ chain: intact, anchor: pending, receiptHead: undefined, bidCount: 3 })).toEqual({ kind: 'no_divergence_until', publishedThroughSeq: 1 });
    expect(headlineOf({ chain: intact, anchor: { status: 'pending', publishedThroughSeq: 0, stale: true }, receiptHead: undefined, bidCount: 2 })).toEqual({ kind: 'no_divergence_until', publishedThroughSeq: 0 });
  });

  it('(6) says the anchor was not verified when it could not be read or is off, with or without a receipt that was found', () => {
    for (const anchor of [unavailable, off]) {
      expect(headlineOf({ chain: intact, anchor, receiptHead: undefined, bidCount: 3 })).toEqual({ kind: 'anchor_unverified' });
      expect(headlineOf({ chain: intact, anchor, receiptHead: found, bidCount: 3 })).toEqual({ kind: 'anchor_unverified' });
    }
  });

  it('never claims more than was proven, over every combination of the results', () => {
    const chains = [intact, tampered];
    const anchors = [published, pending, divergent, unavailable, off];
    const receipts = [undefined, found, notFound];
    let combinations = 0;
    for (const chain of chains) {
      for (const anchor of anchors) {
        for (const receiptHead of receipts) {
          for (const bidCount of [0, 3]) {
            combinations += 1;
            const headline = headlineOf({ chain, anchor, receiptHead, bidCount });
            const accused = chain.status === 'tampered' || anchor.status === 'divergent';
            expect(headline.kind === 'tampered').toBe(accused);
            if (accused) continue;
            // From here the chain is intact and the anchor is not divergent.
            if (headline.kind === 'intact_until' || headline.kind === 'intact_chain_until') {
              expect(receiptHead?.status).toBe('in_history');
              expect(anchor.status === 'published' || anchor.status === 'pending').toBe(true);
              expect(bidCount).toBeGreaterThan(0);
            }
            if (headline.kind === 'intact_until') expect(anchor.status).toBe('published');
            if (headline.kind === 'no_divergence_until') {
              expect(receiptHead).toBeUndefined();
              expect(anchor.status === 'published' || anchor.status === 'pending').toBe(true);
            }
            if (headline.kind === 'unconfirmed') expect(receiptHead?.status).toBe('not_in_history');
            if (receiptHead?.status === 'not_in_history') expect(headline.kind).toBe('unconfirmed');
            if (anchor.status === 'unavailable' || anchor.status === 'off') expect(['anchor_unverified', 'unconfirmed', 'no_bids']).toContain(headline.kind);
          }
        }
      }
    }
    expect(combinations).toBe(60);
  });
});
