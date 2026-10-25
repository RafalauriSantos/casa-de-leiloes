// The owner's answers in the release script, read the way the release reads them. Kept here, not in the script, so
// they are tested with the rest of the code.

/** An empty leader answer means no leader; otherwise the uuid in the stored form (lower case, no spaces). */
export function parseLeaderAnswer(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed.toLowerCase();
}

/** The amount in cents, only as digits; anything else (empty, a sign, a point, a comma) is refused, never read as zero. */
export function parseAmountAnswer(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isSafeInteger(amount) ? amount : null;
}

/** Only the exact word releases anything. */
export function isConfirmation(text: string): boolean {
  return text.trim() === 'CONFIRMAR';
}
