import { describe, expect, it } from 'vitest';
import { formatBRL, formatDynamicReais, formatReaisInput, maskReaisInput, parseReaisToCents } from './format';

describe('formatBRL', () => {
  it('formats cents as reais', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(100)).toBe('R$ 1,00');
    expect(formatBRL(10_000_000)).toBe('R$ 100.000,00');
    expect(formatBRL(123_456)).toBe('R$ 1.234,56');
  });
});

describe('formatDynamicReais', () => {
  it('formats integer digits with thousands dots as typed', () => {
    expect(formatDynamicReais('')).toBe('');
    expect(formatDynamicReais('1')).toBe('1');
    expect(formatDynamicReais('100')).toBe('100');
    expect(formatDynamicReais('1000')).toBe('1.000');
    expect(formatDynamicReais('1000000')).toBe('1.000.000');
    expect(formatDynamicReais('10000000')).toBe('10.000.000');
  });

  it('preserves decimals when typed', () => {
    expect(formatDynamicReais('1000,5')).toBe('1.000,5');
    expect(formatDynamicReais('1000000,50')).toBe('1.000.000,50');
  });

  it('leaves invalid or non-numeric strings intact for validation', () => {
    expect(formatDynamicReais('abc')).toBe('abc');
    expect(formatDynamicReais('1,234')).toBe('1,234');
    expect(formatDynamicReais('-5')).toBe('-5');
    expect(formatDynamicReais('0,001')).toBe('0,001');
  });
});

describe('formatReaisInput', () => {
  it('formats integer cents as a two-decimal field value without floating point', () => {
    expect(formatReaisInput(0)).toBe('0,00');
    expect(formatReaisInput(5)).toBe('0,05');
    expect(formatReaisInput(50)).toBe('0,50');
    expect(formatReaisInput(5_050)).toBe('50,50');
    expect(formatReaisInput(50_000)).toBe('500,00');
    expect(formatReaisInput(100_000_000)).toBe('1.000.000,00');
    expect(formatReaisInput(1_000_000_000)).toBe('10.000.000,00');
  });
});

describe('maskReaisInput', () => {
  it('formats keystrokes into real-time currency', () => {
    expect(maskReaisInput('')).toBe('');
    expect(maskReaisInput('0')).toBe('0,00');
    expect(maskReaisInput('1')).toBe('0,01');
    expect(maskReaisInput('10')).toBe('0,10');
    expect(maskReaisInput('100')).toBe('1,00');
    expect(maskReaisInput('1000')).toBe('10,00');
    expect(maskReaisInput('10000')).toBe('100,00');
    expect(maskReaisInput('100000')).toBe('1.000,00');
    expect(maskReaisInput('1000000')).toBe('10.000,00');
    expect(maskReaisInput('10000000')).toBe('100.000,00');
    expect(maskReaisInput('100000000')).toBe('1.000.000,00');
    expect(maskReaisInput('1000000000')).toBe('10.000.000,00');
  });

  it('handles paste with non-digit characters', () => {
    expect(maskReaisInput('R$ 1.234,56')).toBe('1.234,56');
    expect(maskReaisInput('abc 500 def')).toBe('5,00');
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
