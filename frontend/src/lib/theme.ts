// The light/dark switch (B21). With no stored choice, the page follows the system theme through CSS; a choice is
// kept in this browser's localStorage. Storage can be blocked (private windows), so each access is guarded.
export type Theme = 'light' | 'dark';

const KEY = 'theme';

export function storedTheme(): Theme | undefined {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Sets the theme on the page; undefined goes back to the system theme. */
export function applyTheme(theme: Theme | undefined): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** The theme on screen now: the chosen one, or the system's. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function chooseTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Storage is blocked: the choice lasts until the page is closed.
  }
}
