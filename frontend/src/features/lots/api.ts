import type { AuctioneerSummary, BidAccepted, CatalogPage, CreateLotInput, LiveLot, LotDetail, LotInput, LotSummary, OwnLot } from '@casa/contracts';
import { apiFetch } from '@/lib/api-client';
import { announceWalletChange } from '@/lib/wallet-events';

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

export function searchCatalog(token: string, q: string, page: number): Promise<CatalogPage> {
  return apiFetch<CatalogPage>(`/api/catalog/search?${new URLSearchParams({ q, page: String(page) }).toString()}`, { token });
}

export function fetchAuctioneerSummary(token: string): Promise<AuctioneerSummary> {
  return apiFetch<AuctioneerSummary>('/api/auctioneer/summary', { token });
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

export function fetchLive(id: string, token: string | undefined): Promise<LiveLot> {
  return apiFetch<LiveLot>(`/api/lots/${id}/live`, token ? { token } : {});
}

export function placeBid(token: string, id: string, amountCents: number): Promise<BidAccepted> {
  return apiFetch<BidAccepted>(`/api/lots/${id}/bids`, { token, method: 'POST', body: { amountCents } }).then((accepted) => {
    announceWalletChange();
    return accepted;
  });
}
