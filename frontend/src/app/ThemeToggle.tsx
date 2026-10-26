import { useState } from 'react';
import { chooseTheme, currentTheme } from '@/lib/theme';

/** The light/dark switch in the menu (B21). Its label names the theme it switches to. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="link"
      onClick={() => {
        chooseTheme(next);
        setTheme(next);
      }}
    >
      {next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro'}
    </button>
  );
}
