/** Simulated deposit limits, in cents: R$ 1,00 to R$ 100.000,00 per deposit. Shared by the API and the UI. */
export const DEPOSIT_MIN_CENTS = 100;
export const DEPOSIT_MAX_CENTS = 10_000_000;

/** Lot money limits in integer cents: a starting bid up to R$ 10.000.000,00, an increment up to R$ 100.000,00. */
export const MAX_STARTING_BID_CENTS = 1_000_000_000;
export const MAX_INCREMENT_CENTS = 10_000_000;

/** A lot takes at most this many bids. Its anchor file stays far below the size the publisher accepts (D23). */
export const MAX_BIDS_PER_LOT = 1000;

/** What the server answers when a lot is full, and what the room says: one text for both. */
export const BID_LIMIT_MESSAGE = `Este lote atingiu o limite de ${new Intl.NumberFormat('pt-BR').format(MAX_BIDS_PER_LOT)} lances.`;
