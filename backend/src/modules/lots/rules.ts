import type { LotResult, LotState } from '@casa/contracts';

/** A lot is at least one minute long, so a bidding window cannot be empty. */
export const MIN_DURATION_MS = 60_000;

export interface LotTiming {
  startsAt: Date;
  endsAt: Date;
  cancelled: boolean;
}

export interface Refusal {
  code: 'lot_not_editable' | 'lot_ended';
  message: string;
}

/**
 * The state of a lot at `now`. Start is inclusive and end is exclusive: a lot that starts this
 * instant is live, and a lot that ends this instant has ended.
 */
export function stateOf(lot: LotTiming, now: Date): LotState {
  if (lot.cancelled) return 'cancelled';
  if (now.getTime() < lot.startsAt.getTime()) return 'scheduled';
  if (now.getTime() < lot.endsAt.getTime()) return 'live';
  return 'ended';
}

/** Returns the reason the times are refused, or undefined when they are acceptable. */
export function checkTiming(startsAt: Date, endsAt: Date, now: Date): string | undefined {
  if (endsAt.getTime() <= startsAt.getTime()) return 'O fim do lote precisa ser depois do início.';
  if (endsAt.getTime() - startsAt.getTime() < MIN_DURATION_MS) return 'O lote precisa durar pelo menos 1 minuto.';
  if (startsAt.getTime() <= now.getTime()) return 'O lote precisa começar no futuro.';
  return undefined;
}

export interface EditState {
  state: LotState;
  bidCount: number;
}

/** Edit: only before the start and only without bids. */
export function editRefusal(lot: EditState): Refusal | undefined {
  if (lot.state === 'cancelled') return { code: 'lot_not_editable', message: 'Lote cancelado não pode ser alterado.' };
  if (lot.state === 'ended') return { code: 'lot_ended', message: 'Lote encerrado não pode ser alterado.' };
  if (lot.state === 'live') return { code: 'lot_not_editable', message: 'Lote já iniciado não pode ser alterado.' };
  if (lot.bidCount > 0) return { code: 'lot_not_editable', message: 'Lote com lances não pode ser alterado.' };
  return undefined;
}

/** Cancel: only a lot without bids that has not ended yet. */
export function cancelRefusal(lot: EditState): Refusal | undefined {
  if (lot.state === 'cancelled') return { code: 'lot_not_editable', message: 'Este lote já foi cancelado.' };
  if (lot.state === 'ended') return { code: 'lot_ended', message: 'Lote encerrado não pode ser cancelado.' };
  if (lot.bidCount > 0) return { code: 'lot_not_editable', message: 'Lote com lances não pode ser cancelado.' };
  return undefined;
}

/** How an ended lot ended, for the auctioneer (1.7). Null while the lot is not over. */
export function resultOf(lot: { state: LotState; settled: boolean; outcome: 'sold' | 'no_bids' | null; amountCents: number | null }): LotResult | null {
  if (lot.state !== 'ended') return null;
  if (!lot.settled || lot.outcome === null) return { outcome: 'pending', amountCents: null };
  if (lot.outcome === 'sold') return { outcome: 'sold', amountCents: lot.amountCents };
  return { outcome: 'no_bids', amountCents: null };
}
