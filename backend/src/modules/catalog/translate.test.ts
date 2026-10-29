import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translateAttribute, translateTitle } from './translate';

// Titles and attributes come from the Met in English. Only the terms of the glossary are translated; anything else
// stays as the Met wrote it (B44, the limitation is registered in D48).
describe('the catalog translates the terms it knows (B44)', () => {
  it('translates a known title and keeps an unknown one as it is', () => {
    expect(translateTitle('Carriage Clock')).toBe('Relógio de carruagem');
    expect(translateTitle('Sword')).toBe('Espada');
    expect(translateTitle('Box with Ọ́bà Ozolua and unidentified')).toBe('Box with Ọ́bà Ozolua and unidentified');
  });

  it('translates a known department and keeps an unknown one', () => {
    expect(translateAttribute('The American Wing')).toBe('Ala Americana');
    expect(translateAttribute('Greek and Roman Art')).toBe('Arte Grega e Romana');
    expect(translateAttribute('Brass, glass, enamel')).toBe('Brass, glass, enamel');
  });

  it('a real captured object from the Met comes out with its title translated', async () => {
    const { toItem } = await import('./met-client');
    const object = JSON.parse(readFileSync(fileURLToPath(new URL('../../../tests/fixtures/met/objects/1454.json', import.meta.url)), 'utf8')) as unknown;
    const item = toItem(object as Parameters<typeof toItem>[0]);
    expect(item?.title).toBe('Relógio de carruagem');
    expect(item?.attributes.department).toBe('Ala Americana');
  });
});
