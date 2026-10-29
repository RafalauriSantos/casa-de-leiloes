// Sets the stored theme before the first paint (B41). It is a file, not an inline script, because the site's
// Content-Security-Policy (vercel.json) allows scripts from this origin only. The key 'theme' must match src/lib/theme.ts.
try {
  var stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
} catch (error) {
  // Storage is blocked: the system theme applies.
}
