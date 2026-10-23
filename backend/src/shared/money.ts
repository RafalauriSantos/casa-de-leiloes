const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formats integer cents as Brazilian reais, e.g. 10000000 -> "R$ 100.000,00". */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/\u00a0/g, ' ');
}
