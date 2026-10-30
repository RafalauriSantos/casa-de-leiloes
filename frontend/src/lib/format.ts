const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MAX_REAIS_DIGITS = 10;

/** Integer cents to "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/\u00a0/g, ' ');
}

/** Integer cents to a plain field value with two decimals ("500,00", "0,05"), without floating point. */
export function formatReaisInput(cents: number): string {
  const digits = String(cents).padStart(3, '0');
  const integer = digits.slice(0, -2);
  const decimal = digits.slice(-2);
  const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formattedInteger},${decimal}`;
}

/**
 * Formats user input dynamically as typed:
 * - When digits are typed (e.g. "1000000"), formats with thousands dots ("1.000.000").
 * - Preserves decimals if typed ("1000000,50" -> "1.000.000,50").
 * - Leaves invalid values (letters, negative signs, 3+ decimal digits) intact so form validation can report them.
 */
export function formatDynamicReais(raw: string): string {
  if (!raw.trim()) return '';
  const parts = raw.split(',');
  if (parts.length > 2) return raw;
  if (parts[1] && parts[1].length > 2) return raw;
  const integerRaw = parts[0]?.replace(/\./g, '') ?? '';
  if (!/^\d+$/.test(integerRaw)) return raw;

  const formattedInteger = integerRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (parts.length === 2) {
    return `${formattedInteger},${parts[1]}`;
  }
  return formattedInteger;
}

/**
 * Formats a raw user input into Brazilian Reais currency format in real-time ("1.000.000,00").
 * Strips non-digit characters and treats the digits as cents, automatically adding thousands separators
 * and two decimal places.
 */
export function maskReaisInput(raw: string, maxDigits = 12): string {
  const digits = raw.replace(/\D/g, '').slice(0, maxDigits);
  if (!digits) return '';
  const asNumber = Number(digits);
  if (asNumber === 0) return '0,00';
  return formatReaisInput(asNumber);
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
