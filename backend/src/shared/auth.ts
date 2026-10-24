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

/** Verifies the bearer token and returns the user id, or throws the caller's 401. */
async function verifyToken(header: string | undefined, keys: ReturnType<typeof createRemoteJWKSet>, issuer: string): Promise<string | undefined> {
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) return undefined;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated', algorithms: ALGORITHMS }));
  } catch (err) {
    if (TOKEN_ERRORS.some((tokenError) => err instanceof tokenError)) throw new AppError('unauthenticated', INVALID);
    throw err;
  }
  if (!payload.sub) throw new AppError('unauthenticated', INVALID);
  return payload.sub;
}

/** Public routes that show more to a signed-in user: no token is fine, a bad token is still refused. */
export function optionalAuthMiddleware(config: Pick<Config, 'supabaseUrl'>): MiddlewareHandler<OptionalAuthEnv> {
  const issuer = `${config.supabaseUrl}/auth/v1`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (c, next) => {
    const userId = await verifyToken(c.req.header('Authorization'), keys, issuer);
    c.set('userId', userId);
    await next();
  };
}

export interface OptionalAuthEnv {
  Variables: { userId: string | undefined };
}

/**
 * Identity comes only from the Supabase JWT, verified against the project's public keys (JWKS).
 * Nothing about who the caller is is ever read from the request body.
 */
export function authMiddleware(config: Pick<Config, 'supabaseUrl'>): MiddlewareHandler<AuthEnv> {
  const issuer = `${config.supabaseUrl}/auth/v1`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (c, next) => {
    const userId = await verifyToken(c.req.header('Authorization'), keys, issuer);
    if (userId === undefined) throw new AppError('unauthenticated', 'Faça login para continuar.');
    c.set('userId', userId);
    await next();
  };
}
