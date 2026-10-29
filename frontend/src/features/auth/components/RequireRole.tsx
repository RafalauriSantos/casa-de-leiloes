import type { UserRole } from '@casa/contracts';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-context';

const AREA: Record<UserRole, string> = { bidder: 'licitantes', auctioneer: 'leiloeiros' };

/** Screen guard: the API enforces the role too (401/403); this only avoids showing a screen that cannot work. */
export function RequireRole({ role, children }: { role: UserRole; children: (token: string) => ReactNode }) {
  const auth = useAuth();
  const { pathname, search } = useLocation();

  if (auth.status === 'loading') return <p>Carregando…</p>;
  if (auth.status === 'signed-out') return <Navigate to={`/entrar?next=${encodeURIComponent(pathname + search)}`} replace />;
  if (auth.status === 'error') return <p role="alert">{auth.message}</p>;
  if (auth.me.role !== role) {
    const home = auth.me.role === 'auctioneer' ? { to: '/leiloeiro', label: 'Ir para o painel' } : { to: '/', label: 'Voltar aos lotes' };
    return (
      <>
        <p role="alert">Esta área é exclusiva para {AREA[role]}.</p>
        <p><Link to={home.to}>{home.label}</Link></p>
      </>
    );
  }
  return <>{children(auth.token)}</>;
}
