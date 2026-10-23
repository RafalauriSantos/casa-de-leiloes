const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Integer cents to "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/\u00a0/g, ' ');
}

/**
 * Parses what a person types ("1.234,56", "25", "0,5") into integer cents, or undefined when it is
 * not a plain amount with at most two decimals. Pure string handling: no floating point.
 */
export function parseReaisToCents(input: string): number | undefined {
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(input.trim());
  if (!match) return undefined;
  const [, integerPart = '', decimalPart = ''] = match;
  const reais = Number(integerPart.replaceAll('.', ''));
  const cents = Number(decimalPart.padEnd(2, '0'));
  return reais * 100 + cents;
}
