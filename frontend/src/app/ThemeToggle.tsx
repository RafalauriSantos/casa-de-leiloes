import { useState } from 'react';
import { chooseTheme, currentTheme } from '@/lib/theme';

/** The light/dark switch (B21). Its label names the theme it switches to; `iconOnly` shows just the icon, for a header without a menu. */
export function ThemeToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const [theme, setTheme] = useState(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button
      type="button"
      className={iconOnly ? 'link theme-toggle theme-toggle-icon' : 'link theme-toggle'}
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
