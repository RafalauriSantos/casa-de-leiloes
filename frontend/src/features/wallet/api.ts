import type { DepositRequest, WalletResponse } from '@casa/contracts';
import { apiFetch } from '@/lib/api-client';

export function fetchWallet(token: string): Promise<WalletResponse> {
  return apiFetch<WalletResponse>('/api/wallet', { token });
}

/** `key` identifies one deposit intent: a retry with the same key can never credit twice. */
export function postDeposit(token: string, amountCents: number, key: string): Promise<WalletResponse> {
  const body: DepositRequest = { amountCents };
  return apiFetch<WalletResponse>('/api/wallet/deposits', { token, method: 'POST', body, headers: { 'Idempotency-Key': key } });
}
