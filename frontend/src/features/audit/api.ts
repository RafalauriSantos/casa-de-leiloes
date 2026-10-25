import type { AuditReport } from '@casa/contracts';
import { apiFetch } from '@/lib/api-client';

export function fetchAudit(lotId: string, head: string | undefined): Promise<AuditReport> {
  const query = head === undefined ? '' : `?${new URLSearchParams({ head }).toString()}`;
  return apiFetch<AuditReport>(`/api/lots/${lotId}/audit${query}`);
}
