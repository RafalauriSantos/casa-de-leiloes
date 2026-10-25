import type { ChainResult } from '@casa/contracts';

/** The public time of a bid: truncated to the second, never rounded up (D10). Takes an ISO string, so no clock or Date is needed. */
export function truncateToSecond(iso: string): string {
  return `${iso.slice(0, 19)}Z`;
}

/** The chain result from the first broken seq, which `firstBrokenSeq` returns (null when the history is intact). */
export function chainResult(brokenAtSeq: number | null): ChainResult {
  return brokenAtSeq === null ? { status: 'intact' } : { status: 'tampered', brokenAtSeq };
}
