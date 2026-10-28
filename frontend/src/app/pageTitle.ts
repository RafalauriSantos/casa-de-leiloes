import { matchPath } from 'react-router-dom';

/** The title each screen shows in the phone header, and whether the screen's own h1 repeats it. */
const SCREENS: Array<{ path: string; title: string; h1: boolean }> = [
  { path: '/', title: 'Leilões ao vivo', h1: true },
  { path: '/lotes/:id', title: 'Lote', h1: false },
  { path: '/auditoria/:id', title: 'Auditoria', h1: false },
  { path: '/leiloeiro', title: 'Painel do leiloeiro', h1: true },
  { path: '/entrar', title: 'Entrar', h1: false },
  { path: '/carteira', title: 'Carteira', h1: true },
  { path: '/arremates', title: 'Meus arremates', h1: true },
  { path: '/comprovante/:code', title: 'Comprovante', h1: false },
];

export function screenOf(pathname: string): { title: string; h1: boolean } | undefined {
  return SCREENS.find((screen) => matchPath({ path: screen.path, end: true }, pathname) !== null);
}
