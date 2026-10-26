import { BRAZIL_OFFSET } from '@casa/contracts';

const BRAZIL = 'America/Sao_Paulo';
const WHEN = new Intl.DateTimeFormat('pt-BR', { timeZone: BRAZIL, dateStyle: 'short', timeStyle: 'short' });

/** An instant as the Brazilian clock shows it, e.g. "25/10/2026, 10:00". */
export const formatWhen = (iso: string): string => WHEN.format(new Date(iso));

/**
 * The value of a datetime-local field is a wall-clock time in Brazil. It is sent with the explicit
 * offset, so the server stores the right instant whatever the browser's own zone is.
 */
export const toInstant = (local: string): string => `${local}:00${BRAZIL_OFFSET}`;

/** The inverse, for editing: the instant as the field's value. */
export function toLocalField(iso: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: BRAZIL, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return parts.replace(' ', 'T');
}

export const STATE_LABEL = { scheduled: 'Agendado', live: 'Ao vivo', ended: 'Encerrado', cancelled: 'Cancelado' } as const;

/** The time left in a lot: hh:mm:ss under a day, then days before it. Zero or less means it is over. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'encerrado';
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const clock = [Math.floor((total % 86_400) / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  if (days === 0) return clock;
  return `${String(days)} ${days === 1 ? 'dia' : 'dias'} ${clock}`;
}

/**
 * The offset between the server's clock and this browser's, read at the midpoint of the request: the server answered
 * somewhere between sending and receiving, so the midpoint is the best guess.
 */
export function clockOffset(serverNowIso: string, sentAt: number, receivedAt: number): number {
  return new Date(serverNowIso).getTime() - (sentAt + receivedAt) / 2;
}

/** Time left in a lot, in milliseconds, on the server's clock: the browser's clock plus the offset. */
export function remainingMs(endsAtIso: string, offsetMs: number, browserNow: number): number {
  return new Date(endsAtIso).getTime() - (browserNow + offsetMs);
}
