import { describe, expect, it } from 'vitest';
import { formatBRL, formatReaisInput, parseReaisToCents } from './format';

describe('formatBRL', () => {
  it('formats cents as reais', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(100)).toBe('R$ 1,00');
    expect(formatBRL(10_000_000)).toBe('R$ 100.000,00');
    expect(formatBRL(123_456)).toBe('R$ 1.234,56');
  });
});

describe('formatReaisInput', () => {
  it('formats integer cents as a two-decimal field value without floating point', () => {
    expect(formatReaisInput(0)).toBe('0,00');
    expect(formatReaisInput(5)).toBe('0,05');
    expect(formatReaisInput(50)).toBe('0,50');
    expect(formatReaisInput(5_050)).toBe('50,50');
    expect(formatReaisInput(50_000)).toBe('500,00');
  });
});

describe('parseReaisToCents', () => {
  it.each([
    ['1', 100],
    ['1,5', 150],
    ['1,50', 150],
    ['1.234,56', 123_456],
    ['100000', 10_000_000],
    ['  25,00 ', 2_500],
    ['0,01', 1],
    ['9999999999,99', 999_999_999_999],
  ])('parses %s as %i cents', (input, cents) => {
    expect(parseReaisToCents(input)).toBe(cents);
  });

  it.each([
    '',
    'abc',
    '0',
    '0,00',
    '1,234',
    '1,5,0',
    '-5',
    '1e3',
    'R$ 10',
    '0,001',
    '10000000000',
    '9999999999999999999999999',
  ])('rejects %s', (input) => {
    expect(parseReaisToCents(input)).toBeUndefined();
  });

  it('never goes through floating point (0,29 is exactly 29 cents)', () => {
    expect(parseReaisToCents('0,29')).toBe(29);
    expect(parseReaisToCents('19,99')).toBe(1_999);
  });
});

