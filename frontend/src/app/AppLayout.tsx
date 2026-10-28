import { Link, Outlet } from 'react-router-dom';
import { signOut, useAuth } from '@/features/auth';
import { HeaderBalance } from './HeaderBalance';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

export function AppLayout() {
  const auth = useAuth();

  return (
    <>
      <header>
        <nav aria-label="Principal">
          <Link to="/" className="brand" aria-label="Casa de Leilões"><Logo /><span className="brand-name" aria-hidden="true">CASA DE LEILÕES</span></Link>
          {auth.status === 'signed-in' && auth.me.role === 'bidder' && <Link to="/carteira">Carteira</Link>}
          {auth.status === 'signed-in' && auth.me.role === 'bidder' && <Link to="/arremates">Meus arremates</Link>}
          {auth.status === 'signed-in' && auth.me.role === 'auctioneer' && <Link to="/leiloeiro">Painel do leiloeiro</Link>}
          {auth.status === 'signed-out' && <Link to="/entrar">Entrar</Link>}
          {auth.status === 'signed-in' && auth.me.role === 'bidder' && <HeaderBalance token={auth.token} />}
          {auth.status === 'signed-in' && <span>Olá, <strong>{auth.me.displayName}</strong></span>}
          {(auth.status === 'signed-in' || auth.status === 'error') && (
            <button type="button" className="link" onClick={() => void signOut()}>Sair</button>
          )}
          <ThemeToggle />
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
