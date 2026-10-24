import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError, ErrorCode } from '@casa/contracts';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  validation_error: 422,
  bid_below_minimum: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  insufficient_funds: 409,
  already_leading: 409,
  lot_not_started: 409,
  lot_ended: 409,
  lot_cancelled: 409,
  lot_not_editable: 409,
  idempotency_conflict: 409,
  catalog_unavailable: 503,
  internal_error: 500,
};

/** A business or protocol error with a stable code and a message that is safe to show to the user. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** The single error shape of the API: `{ code, message }` with the right HTTP status. */
export function errorResponse(c: Context, code: ErrorCode, message: string): Response {
  const body: ApiError = { code, message };
  return c.json(body, STATUS[code]);
}

export function handleError(err: unknown, c: Context): Response {
  if (err instanceof AppError) return errorResponse(c, err.code, err.message);
  // Never leak a stack or a database message to the client.
  console.error('unhandled error:', err instanceof Error ? (err.stack ?? err.message) : 'non-error value thrown');
  return errorResponse(c, 'internal_error', 'Erro interno. Tente novamente.');
}

export function handleNotFound(c: Context): Response {
  return errorResponse(c, 'not_found', 'Recurso não encontrado.');
}
