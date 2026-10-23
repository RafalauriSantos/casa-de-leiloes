export interface Intent {
  cents: number;
  key: string;
}

/**
 * One idempotency key per deposit intent. Retrying the same amount reuses the key (a lost response
 * can never credit twice); a different amount is a different intent and gets a new key.
 */
export function intentFor(previous: Intent | undefined, cents: number, newKey: () => string = () => crypto.randomUUID()): Intent {
  return previous?.cents === cents ? previous : { cents, key: newKey() };
}
