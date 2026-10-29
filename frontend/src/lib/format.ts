const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MAX_REAIS_DIGITS = 10;

/** Integer cents to "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/\u00a0/g, ' ');
}

/** Integer cents to a plain field value with two decimals ("500,00", "0,05"), without floating point. */
export function formatReaisInput(cents: number): string {
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)},${digits.slice(-2)}`;
}

/**
 * Parses what a person types ("1.234,56", "25", "0,5") into positive integer cents (up to 10 integer
 * digits), or undefined when it is zero, out of range, or not a plain amount with at most two decimals.
 * Pure string handling: no floating point.
 */
export function parseReaisToCents(input: string): number | undefined {
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(input.trim());
  if (!match) return undefined;
  const [, integerPart = '', decimalPart = ''] = match;
  const digits = integerPart.replaceAll('.', '');
  if (digits.length > MAX_REAIS_DIGITS) return undefined;
  const cents = Number(`${digits}${decimalPart.padEnd(2, '0')}`);
  return cents > 0 ? cents : undefined;
}
