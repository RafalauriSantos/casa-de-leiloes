/** Every error the API can return. One shape, always: `{ code, message }`. */
export const ERROR_CODES = [
  'validation_error',
  'bid_below_minimum',
  'unauthenticated',
  'forbidden',
  'not_found',
  'insufficient_funds',
  'already_leading',
  'lot_not_started',
  'lot_ended',
  'lot_not_editable',
  'idempotency_conflict',
  'catalog_unavailable',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const { code, message } = value as Record<string, unknown>;
  return (
    typeof message === 'string' &&
    typeof code === 'string' &&
    (ERROR_CODES as readonly string[]).includes(code)
  );
}
