import { DEPOSIT_MAX_CENTS, DEPOSIT_MIN_CENTS } from '@casa/contracts';
import { formatBRL } from '../../shared/money';

export interface WalletBalances {
  totalCents: number;
  committedCents: number;
}

/** Available = total - committed. A wallet where committed exceeds total is a bug, never a negative balance. */
export function availableCents(wallet: WalletBalances): number {
  if (wallet.committedCents > wallet.totalCents) {
    throw new Error('wallet invariant violated: committed exceeds total');
  }
  return wallet.totalCents - wallet.committedCents;
}

/** Returns the reason a deposit is refused, or undefined when it is acceptable. */
export function checkDeposit(amountCents: number): string | undefined {
  if (amountCents < DEPOSIT_MIN_CENTS || amountCents > DEPOSIT_MAX_CENTS) {
    return `O depósito deve ser de ${formatBRL(DEPOSIT_MIN_CENTS)} a ${formatBRL(DEPOSIT_MAX_CENTS)}.`;
  }
  return undefined;
}
