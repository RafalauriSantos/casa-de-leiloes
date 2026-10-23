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
