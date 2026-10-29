import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { applyTheme, storedTheme } from '@/lib/theme';
import '@/styles/global.css';

// public/theme-init.js already sets the stored theme before the first paint; this keeps the choice even if that file is not served.
applyTheme(storedTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
