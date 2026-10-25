import type { BidReceipt } from '@casa/contracts';

// The bid receipts a bidder keeps on this device, so the head survives a reload. Each bidder has their
// own list, so a shared device never shows one person's receipts to another. Storage can be missing,
// refuse access (private windows) or hold data from another version, so every read and write is
// guarded and never throws. Entries that are not receipts are skipped; the valid ones are kept.

const key = (userId: string, lotId: string) => `receipts:${userId}:${lotId}`;

function isReceipt(value: unknown): value is BidReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.seq === 'number' &&
    Number.isInteger(candidate.seq) &&
    candidate.seq > 0 &&
    typeof candidate.head === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.head) &&
    typeof candidate.placedAt === 'string'
  );
}

/** Keeps one receipt per sequence number, oldest first. */
function normalize(receipts: BidReceipt[]): BidReceipt[] {
  const bySeq = new Map<number, BidReceipt>();
  for (const receipt of receipts) bySeq.set(receipt.seq, receipt);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function readReceipts(userId: string, lotId: string): BidReceipt[] {
  try {
    const raw = window.localStorage.getItem(key(userId, lotId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: unknown[] = parsed;
    return normalize(items.filter(isReceipt));
  } catch {
    return [];
  }
}

/**
 * Adds a receipt to the bidder's list. The result merges what is stored with what the screen already
 * shows, so a receipt is kept even when storage is unavailable, and receipts saved by another open tab
 * are not lost.
 */
export function addReceipt(userId: string, lotId: string, receipt: BidReceipt, shown: BidReceipt[]): BidReceipt[] {
  const next = normalize([...readReceipts(userId, lotId), ...shown, receipt]);
  try {
    window.localStorage.setItem(key(userId, lotId), JSON.stringify(next));
  } catch {
    // Not stored on this device: the receipts are still shown for this visit.
  }
  return next;
}
