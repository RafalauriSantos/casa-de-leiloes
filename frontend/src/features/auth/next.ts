function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * The page to go to after sign-in, from the `next` parameter. Only a path of this app is followed: anything that could
 * leave the site (`//host`, `https://host`, `/\\host`) goes to the home page instead.
 */
export function safeNext(value: string | null): string {
  // Control characters are dropped by the URL parser, so `/<tab>/host` would become `//host` for the browser.
  if (value === null || hasControlCharacter(value)) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
