import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { signOut } from '@/features/auth';
import { formatBRL } from '@/lib/format';
import { ThemeToggle } from './ThemeToggle';

export type NavItem = { to: string; label: string };

interface Props {
  name: string;
  roleLabel: string;
  availableCents?: number;
  links: NavItem[];
}

/** The account: the name opens a panel with who is signed in, the places of their role (on a phone, where the header has no links), the theme and the exit. */
export function AccountMenu({ name, roleLabel, availableCents, links }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPress = (event: MouseEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [open]);

  return (
    <div className="account" ref={root}>
      <button type="button" className="account-button" ref={button} aria-haspopup="dialog" aria-expanded={open} aria-label="Menu da conta" onClick={() => { setOpen((value) => !value); }}>
        <span className="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
        <span className="account-name">{name}</span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Menu da conta" className="account-panel">
          <div className="account-who">
            <strong>{name}</strong>
            <span>{roleLabel}{availableCents === undefined ? '' : ` · saldo ${formatBRL(availableCents)}`}</span>
          </div>
          <nav aria-label="Seus lugares" className="account-nav">
            {links.map((link) => <NavLink key={link.to} to={link.to} end>{link.label}</NavLink>)}
          </nav>
          <ThemeToggle />
          <button type="button" className="account-item" onClick={() => void signOut()}>Sair</button>
        </div>
      )}
    </div>
  );
}
