export type UserRole = 'auctioneer' | 'bidder';

export interface HealthResponse {
  status: 'ok';
  database: 'ok';
}

export interface MeResponse {
  id: string;
  role: UserRole;
  displayName: string;
}
