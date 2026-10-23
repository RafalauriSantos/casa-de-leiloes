import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { UserRole } from '@casa/contracts';
import type { Config } from '../config';
import { AppError } from './errors';

export interface AuthEnv {
  Variables: { userId: string; role: UserRole };
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

    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated' });
      if (!payload.sub) throw new Error('token without subject');
      c.set('userId', payload.sub);
    } catch {
      throw new AppError('unauthenticated', 'Sessão inválida ou expirada. Faça login novamente.');
    }
    await next();
  };
}
