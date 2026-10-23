import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Config } from '../config';
import { AppError } from './errors';

const ALGORITHMS = ['ES256', 'RS256'];

/** Errors that mean "this token is not acceptable". Anything else (key server down, bad key set, bug) is ours. */
const TOKEN_ERRORS = [
  joseErrors.JWTExpired,
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JWTInvalid,
  joseErrors.JWSInvalid,
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JWKSNoMatchingKey,
  joseErrors.JWKSMultipleMatchingKeys,
  joseErrors.JOSEAlgNotAllowed,
];
const INVALID = 'Sessão inválida ou expirada. Faça login novamente.';

export interface AuthEnv {
  Variables: { userId: string };
}

/**
 * Identity comes only from the Supabase JWT, verified against the project's public keys (JWKS).
 * Nothing about who the caller is is ever read from the request body.
 */
export function authMiddleware(config: Pick<Config, 'supabaseUrl'>): MiddlewareHandler<AuthEnv> {
  const issuer = `${config.supabaseUrl}/auth/v1`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (c, next) => {
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new AppError('unauthenticated', 'Faça login para continuar.');

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated', algorithms: ALGORITHMS }));
    } catch (err) {
      // A bad, expired or foreign token is the caller's problem (401). The key server being
      // unreachable, answering 503 or sending garbage is ours: it must surface as an error, not as
      // "log in again".
      if (TOKEN_ERRORS.some((tokenError) => err instanceof tokenError)) throw new AppError('unauthenticated', INVALID);
      throw err;
    }
    if (!payload.sub) throw new AppError('unauthenticated', INVALID);
    c.set('userId', payload.sub);
    await next();
  };
}
