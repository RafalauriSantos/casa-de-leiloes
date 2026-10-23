/** Derived from the server clock, never stored: a lot is scheduled before it starts, live until it ends. */
export type LotState = 'scheduled' | 'live' | 'ended' | 'cancelled';

export interface ItemAttributes {
  artist: string | null;
  date: string | null;
  medium: string | null;
  department: string | null;
  culture: string | null;
}

/** An item as the external catalog presents it (search result or the snapshot copied into a lot). */
export interface ItemSummary {
  externalId: string;
  title: string;
  imageUrl: string;
  sourceUrl: string;
  attributes: ItemAttributes;
}

export interface LotSummary {
  id: string;
  title: string;
  imageUrl: string;
  startsAt: string;
  endsAt: string;
  startingBidCents: number;
  incrementCents: number;
  state: LotState;
  /** Null until the first bid; the bidding slice fills it in. */
  currentAmountCents: number | null;
}

export interface LotDetail extends LotSummary {
  sourceUrl: string;
  attributes: ItemAttributes;
}

/** What the owner sees: the same lot plus what the owner may still do. */
export interface OwnLot extends LotDetail {
  bidCount: number;
  canEdit: boolean;
  canCancel: boolean;
}

/** The fields an auctioneer sets. Times are ISO strings with an explicit offset. */
export interface LotInput {
  title: string;
  startsAt: string;
  endsAt: string;
  startingBidCents: number;
  incrementCents: number;
}

export interface CreateLotInput extends LotInput {
  externalId: string;
}

/** Deposits and bids are simulated in reais: the Brazilian clock for the screen is fixed at UTC-03:00. */
export const BRAZIL_OFFSET = '-03:00';
