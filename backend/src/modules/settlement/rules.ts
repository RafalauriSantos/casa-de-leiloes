/** A lot is due at its end time, and not before (the end is exclusive, as in the lot's state). */
export function isDue(endsAt: Date, now: Date): boolean {
  return now.getTime() >= endsAt.getTime();
}
