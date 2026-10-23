// Node's fetch needs absolute URLs; a browser resolves "/api/..." against the page. This gives the
// jsdom tests the browser behavior so the app's relative calls reach the real API.
const nodeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
  nodeFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.href) : input, init);
