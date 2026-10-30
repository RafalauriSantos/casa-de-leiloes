import { useEffect, useState } from 'react';
import { chooseTheme, currentTheme } from '@/lib/theme';

/** The light/dark switch (B21). Its label names the theme it switches to; `iconOnly` shows just the icon, for a header without a menu. */
export function ThemeToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(currentTheme());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); };
  }, []);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button
      type="button"
      className={iconOnly ? 'link theme-toggle theme-toggle-icon' : 'link theme-toggle'}
      data-current-theme={theme}
      aria-label={label}
      title={label}
      onClick={() => {
        chooseTheme(next);
        setTheme(next);
      }}
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-icon theme-switch-moon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" focusable="false">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </span>
        <span className="theme-switch-icon theme-switch-sun">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" focusable="false">
            <circle cx="12" cy="12" r="4.8" fill="currentColor" stroke="none" />
            <line x1="12" y1="1.5" x2="12" y2="4.2" />
            <line x1="12" y1="19.8" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="4.2" y2="12" />
            <line x1="19.8" y1="12" x2="22.5" y2="12" />
            <line x1="4.58" y1="4.58" x2="6.48" y2="6.48" />
            <line x1="17.52" y1="17.52" x2="19.42" y2="19.42" />
            <line x1="4.58" y1="19.42" x2="6.48" y2="17.52" />
            <line x1="17.52" y1="6.48" x2="19.42" y2="4.58" />
          </svg>
        </span>
        <span className="theme-switch-thumb" />
      </span>
      <span className="theme-toggle-text">{label}</span>
    </button>
  );
}
