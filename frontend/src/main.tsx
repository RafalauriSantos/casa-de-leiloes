import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { applyTheme, storedTheme } from '@/lib/theme';
import '@/styles/global.css';

// Before the first render, so a stored theme does not flash the other one.
applyTheme(storedTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
