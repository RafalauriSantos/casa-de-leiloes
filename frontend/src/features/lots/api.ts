import type { CreateLotInput, ItemSummary, LotDetail, LotInput, LotSummary, OwnLot } from '@casa/contracts';
import { apiFetch } from '@/lib/api-client';

export type ShowcaseStatus = 'live' | 'scheduled' | 'ended';

export function fetchLots(filter: { status?: ShowcaseStatus; q?: string }): Promise<LotSummary[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.q) params.set('q', filter.q);
  const query = params.toString();
  return apiFetch<LotSummary[]>(`/api/lots${query ? `?${query}` : ''}`);
}

export function fetchLot(id: string): Promise<LotDetail> {
  return apiFetch<LotDetail>(`/api/lots/${id}`);
}

export function searchCatalog(token: string, q: string): Promise<ItemSummary[]> {
  return apiFetch<ItemSummary[]>(`/api/catalog/search?${new URLSearchParams({ q }).toString()}`, { token });
}

export function fetchOwnLots(token: string): Promise<OwnLot[]> {
  return apiFetch<OwnLot[]>('/api/auctioneer/lots', { token });
}

export function createLot(token: string, body: CreateLotInput): Promise<OwnLot> {
  return apiFetch<OwnLot>('/api/lots', { token, method: 'POST', body });
}

export function updateLot(token: string, id: string, body: LotInput): Promise<OwnLot> {
  return apiFetch<OwnLot>(`/api/lots/${id}`, { token, method: 'PATCH', body });
}

export function cancelLot(token: string, id: string): Promise<OwnLot> {
  return apiFetch<OwnLot>(`/api/lots/${id}/cancel`, { token, method: 'POST' });
}
