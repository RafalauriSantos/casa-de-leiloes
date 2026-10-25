/** A lot is due at its end time, and not before (the end is exclusive, as in the lot's state). */
export function isDue(endsAt: Date, now: Date): boolean {
  return now.getTime() >= endsAt.getTime();
}

/**
 * The publisher's counter must say that the last bid was published before money moves (D21, the owner's option B; the audit
 * compares the file with that counter afterwards). A lot that has bids and whose last one the publisher has not written
 * yet waits: it is not settled, and it is not a failure. A lot with no bids
 * has nothing to publish, and with the anchor off (preview and local runs) there is no public anchor to wait for.
 */
export function mustWaitForAnchor(input: { anchorMode: 'github' | 'off'; anchoredSeq: number; headSeq: number }): boolean {
  return input.anchorMode === 'github' && input.anchoredSeq < input.headSeq;
}
