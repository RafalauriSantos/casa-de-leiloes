import { Link, Outlet } from 'react-router-dom';
import { signOut, useAuth } from '@/features/auth';

export function AppLayout() {
  const auth = useAuth();

  return (
    <>
      <header>
        <nav aria-label="Principal">
          <Link to="/">Casa de Leilões</Link>
          {auth.status === 'signed-in' && auth.me.role === 'bidder' && <Link to="/carteira">Carteira</Link>}
          {auth.status === 'signed-in' && auth.me.role === 'auctioneer' && <Link to="/leiloeiro">Painel do leiloeiro</Link>}
          {auth.status === 'signed-out' && <Link to="/entrar">Entrar</Link>}
          {auth.status === 'signed-in' && <span>Olá, <strong>{auth.me.displayName}</strong></span>}
          {(auth.status === 'signed-in' || auth.status === 'error') && (
            <button type="button" className="link" onClick={() => void signOut()}>Sair</button>
          )}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
