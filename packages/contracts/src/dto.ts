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

export interface WalletResponse {
  totalCents: number;
  committedCents: number;
  /** Always total - committed. */
  availableCents: number;
}

export interface DepositRequest {
  amountCents: number;
}
