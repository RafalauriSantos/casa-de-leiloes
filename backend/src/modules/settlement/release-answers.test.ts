import { describe, expect, it } from 'vitest';
import { isConfirmation, parseAmountAnswer, parseLeaderAnswer } from './release-answers';

describe('the owner answers of the release script, read as the release reads them', () => {
  it('reads an empty leader as no leader, and a uuid in any case as the stored lower-case form', () => {
    expect(parseLeaderAnswer('')).toBeNull();
    expect(parseLeaderAnswer('   ')).toBeNull();
    expect(parseLeaderAnswer('  9F8A0B1C-2D3E-4F50-8192-A3B4C5D6E7F8  ')).toBe('9f8a0b1c-2d3e-4f50-8192-a3b4c5d6e7f8');
  });

  it('reads an amount only as digits, never as an empty answer or a number with a sign or a point', () => {
    expect(parseAmountAnswer('55000')).toBe(55_000);
    expect(parseAmountAnswer('0')).toBe(0);
    expect(parseAmountAnswer('')).toBeNull();
    expect(parseAmountAnswer('   ')).toBeNull();
    expect(parseAmountAnswer('55,00')).toBeNull();
    expect(parseAmountAnswer('-5')).toBeNull();
    expect(parseAmountAnswer('5.5')).toBeNull();
    expect(parseAmountAnswer('9007199254740993')).toBeNull();
  });

  it('confirms only the exact word, in capitals, with surrounding spaces ignored', () => {
    expect(isConfirmation('CONFIRMAR')).toBe(true);
    expect(isConfirmation('  CONFIRMAR  ')).toBe(true);
    expect(isConfirmation('confirmar')).toBe(false);
    expect(isConfirmation('')).toBe(false);
    expect(isConfirmation('SIM')).toBe(false);
  });
});
