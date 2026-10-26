import type { MyLot, ReceiptView } from '@casa/contracts';
import { apiFetch } from '@/lib/api-client';

export function fetchMyLots(token: string): Promise<MyLot[]> {
  return apiFetch<MyLot[]>('/api/me/wins', { token });
}

/** Public: whoever holds the code may read the receipt. */
export function fetchReceipt(code: string): Promise<ReceiptView> {
  return apiFetch<ReceiptView>(`/api/receipts/${encodeURIComponent(code)}`);
}
