import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { signOut, useAuth } from '@/features/auth';
import { AccountMenu, type NavItem } from './AccountMenu';
import { HeaderBalance, useAvailableBalance } from './HeaderBalance';
import { Logo } from './Logo';
import { screenOf } from './pageTitle';
import { ThemeToggle } from './ThemeToggle';

const BIDDER_LINKS: NavItem[] = [
  { to: '/', label: 'Leilões' },
  { to: '/arremates', label: 'Meus arremates' },
  { to: '/carteira', label: 'Carteira' },
];
const AUCTIONEER_LINKS: NavItem[] = [{ to: '/leiloeiro', label: 'Painel' }, { to: '/', label: 'Leilões' }];
const VISITOR_LINKS: NavItem[] = [{ to: '/', label: 'Leilões' }];

export function AppLayout() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const screen = screenOf(pathname);
  const me = auth.status === 'signed-in' ? auth.me : undefined;
  const bidder = me?.role === 'bidder';
  const available = useAvailableBalance(auth.status === 'signed-in' && bidder ? auth.token : undefined, pathname);
  const links = me === undefined ? VISITOR_LINKS : bidder ? BIDDER_LINKS : AUCTIONEER_LINKS;
  const onSignIn = pathname === '/entrar' && auth.status === 'signed-out';
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  // Each screen names itself in the tab. A move to another screen puts focus on its heading, or on its main region
  // while the heading is still on its way (a lot page loads its title). The first screen the app opens keeps focus where the browser put it.
  useEffect(() => {
    document.title = screen ? `${screen.title} · Casa de Leilões` : 'Página não encontrada · Casa de Leilões';
    const moved = previousPath.current !== pathname;
    previousPath.current = pathname;
    const main = mainRef.current;
    if (!moved || !main) return;
    const focusHeading = (): boolean => {
      const heading = main.querySelector('h1');
      if (!heading) return false;
      heading.setAttribute('tabindex', '-1');
      heading.focus();
      return true;
    };
    if (focusHeading()) return;
    main.setAttribute('tabindex', '-1');
    main.focus();
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => { observer.disconnect(); };
  }, [pathname, screen]);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to={me?.role === 'auctioneer' ? '/leiloeiro' : '/'} className="brand" aria-label="Casa de Leilões"><Logo /><span className="brand-name" aria-hidden="true">CASA DE LEILÕES</span></Link>
          {auth.status === 'signed-out' && pathname !== '/' && pathname !== '/entrar' && <Link to="/" className="header-back" aria-label="Voltar aos lotes"><svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true" focusable="false"><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></Link>}
          {screen && !onSignIn && <span className="screen-title" aria-hidden="true">{screen.title}</span>}
          {!onSignIn && (
            <nav aria-label="Principal" className="main-nav">
              {links.map((link) => <NavLink key={link.to} to={link.to} end>{link.label}</NavLink>)}
            </nav>
          )}
          <div className="header-end">
            {me !== undefined && bidder && available !== undefined && <HeaderBalance availableCents={available} />}
            {me !== undefined && (
              <AccountMenu name={me.displayName} roleLabel={bidder ? 'Conta de licitante' : 'Conta de leiloeiro'} links={links} />
            )}
            {auth.status === 'error' && <button type="button" className="link" onClick={() => void signOut()}>Sair</button>}
            {auth.status === 'signed-out' && (onSignIn ? <Link to="/">Voltar aos lotes</Link> : <Link to="/entrar" className="enter-link">Entrar</Link>)}
            {auth.status === 'signed-out' && <ThemeToggle iconOnly />}
          </div>
        </div>
      </header>
      <main ref={mainRef} data-title-in-header={screen?.h1 ? '' : undefined}>
        <Outlet />
      </main>
    </>
  );
}
