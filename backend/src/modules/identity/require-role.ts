import type { MiddlewareHandler } from 'hono';
import type { UserRole } from '@casa/contracts';
import type { AuthEnv } from '../../shared/auth';
import type { Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { getMe } from './service';

/** Runs after the auth middleware: the role is read from the database, never from the token or the body. */
export function requireRole(db: Queryable, role: UserRole, refusal: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const me = await getMe(db, c.get('userId'));
    if (me.role !== role) throw new AppError('forbidden', refusal);
    await next();
  };
}
