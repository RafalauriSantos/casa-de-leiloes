import { useState } from 'react';
import { chooseTheme, currentTheme } from '@/lib/theme';

/** The light/dark switch in the menu (B21). Its label names the theme it switches to. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button
      type="button"
      className="link theme-toggle"
      aria-label={label}
      onClick={() => {
        chooseTheme(next);
        setTheme(next);
      }}
    >
      <span aria-hidden="true">{next === 'dark' ? '☾' : '☀'}</span>
      <span className="theme-toggle-text">{label}</span>
    </button>
  );
}
