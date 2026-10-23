import type { UserRole } from '@casa/contracts';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth-context';

const AREA: Record<UserRole, string> = { bidder: 'licitantes', auctioneer: 'leiloeiros' };

/** Screen guard: the API enforces the role too (401/403); this only avoids showing a screen that cannot work. */
export function RequireRole({ role, children }: { role: UserRole; children: (token: string) => ReactNode }) {
  const auth = useAuth();

  if (auth.status === 'loading') return <p>Carregando…</p>;
  if (auth.status === 'signed-out') return <Navigate to="/entrar" replace />;
  if (auth.status === 'error') return <p role="alert">{auth.message}</p>;
  if (auth.me.role !== role) return <p role="alert">Esta área é exclusiva para {AREA[role]}.</p>;
  return <>{children(auth.token)}</>;
}
