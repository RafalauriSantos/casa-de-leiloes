import { isApiError, type ErrorCode } from '@casa/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const GENERIC = 'Não foi possível concluir a operação. Tente novamente.';

/** Calls our API and returns the typed body, or throws the API's `{ code, message }` as an ApiRequestError. */
export async function apiFetch<T>(path: string, options: { token?: string; method?: string; body?: unknown; baseUrl?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${options.baseUrl ?? ''}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiRequestError('internal_error', 'Sem conexão com o servidor. Verifique a internet e tente novamente.', 0);
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return body as T;
  if (isApiError(body)) throw new ApiRequestError(body.code, body.message, response.status);
  throw new ApiRequestError('internal_error', GENERIC, response.status);
}
