import type { ErrorCode } from '@casa/contracts';
import { formatBRL } from '../../shared/money';

/** A bid in the last two minutes of a lot extends its end by two minutes (brief: "estende o fim do lote para +2 minutos"). */
export const ANTI_SNIPING_WINDOW_MS = 120_000;

export interface BidLot {
  startsAt: Date;
  endsAt: Date;
  cancelled: boolean;
  startingBidCents: number;
  incrementCents: number;
  currentAmountCents: number | null;
  leaderId: string | null;
}

export interface BidderWallet {
  totalCents: number;
  committedCents: number;
}

export interface BidAttempt {
  bidderId: string;
  amountCents: number;
}

export type BidVerdict =
  | { ok: false; code: ErrorCode; message: string }
  | { ok: true; newEndsAt: Date; releasedLeaderId: string | null; releasedCents: number };

const refuse = (code: ErrorCode, message: string): BidVerdict => ({ ok: false, code, message });

/**
 * Decides one bid from the lot, the bidder's wallet and the clock (`now` is the database's, passed in).
 * Pure: no database, no network, no clock of its own. The caller applies the verdict in one transaction.
 */
export function decideBid(lot: BidLot, wallet: BidderWallet, bid: BidAttempt, now: Date): BidVerdict {
  if (lot.cancelled) return refuse('lot_cancelled', 'Este lote foi cancelado.');
  if (now.getTime() < lot.startsAt.getTime()) return refuse('lot_not_started', 'O lote ainda não começou.');
  if (now.getTime() >= lot.endsAt.getTime()) return refuse('lot_ended', 'Este lote já encerrou.');

  if (lot.leaderId === bid.bidderId) return refuse('already_leading', 'Você já está ganhando este lote.');

  const minimum = lot.currentAmountCents === null ? lot.startingBidCents : lot.currentAmountCents + lot.incrementCents;
  if (bid.amountCents < minimum) {
    return refuse('bid_below_minimum', `O lance mínimo agora é ${formatBRL(minimum)}.`);
  }

  const available = wallet.totalCents - wallet.committedCents;
  if (bid.amountCents > available) {
    return refuse('insufficient_funds', `Saldo disponível insuficiente: você tem ${formatBRL(available)} para lances.`);
  }

  const remaining = lot.endsAt.getTime() - now.getTime();
  const newEndsAt = remaining <= ANTI_SNIPING_WINDOW_MS
    ? new Date(lot.endsAt.getTime() + ANTI_SNIPING_WINDOW_MS)
    : lot.endsAt;

  return {
    ok: true,
    newEndsAt,
    releasedLeaderId: lot.leaderId,
    releasedCents: lot.currentAmountCents ?? 0,
  };
}
