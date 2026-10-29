/**
 * The Met describes its objects in English. We translate only the terms listed here, and keep anything else as the
 * Met wrote it (D48). Exact matches only: a translation we do not have is never guessed.
 */
const TERMS: Readonly<Record<string, string>> = {
  'Carriage Clock': 'Relógio de carruagem',
  Clock: 'Relógio',
  Vase: 'Vaso',
  'Vase (vase Indien)': 'Vaso (vaso indiano)',
  Sword: 'Espada',
  Chair: 'Cadeira',
  Teapot: 'Bule',
  'Box with lid': 'Caixa com tampa',
  Bowl: 'Tigela',
  Plate: 'Prato',
  Cup: 'Xícara',
  Painting: 'Pintura',
  Mirror: 'Espelho',
  Table: 'Mesa',
  'The American Wing': 'Ala Americana',
  'European Sculpture and Decorative Arts': 'Escultura e Artes Decorativas Europeias',
  'Greek and Roman Art': 'Arte Grega e Romana',
};

export function translateTitle(title: string): string {
  return TERMS[title.trim()] ?? title;
}

export function translateAttribute(value: string): string {
  return TERMS[value.trim()] ?? value;
}
