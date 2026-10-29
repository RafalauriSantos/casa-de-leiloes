import { z } from 'zod';
import { formatBRL } from '../../shared/money';
import { MAX_INCREMENT_CENTS, MAX_STARTING_BID_CENTS } from './limits';

/** Times must carry their offset: a clock without one is refused instead of guessed. */
const timestamp = z.iso.datetime({ offset: true, message: 'Informe a data e a hora com fuso horário.' });

export const lotInput = z.object({
  title: z.string().trim().min(3, 'O título precisa ter pelo menos 3 caracteres.').max(120, 'O título pode ter até 120 caracteres.'),
  startsAt: timestamp,
  endsAt: timestamp,
  startingBidCents: z
    .number('Informe o lance inicial em centavos, como número inteiro.')
    .int('Informe o lance inicial em centavos, como número inteiro.')
    .positive('O lance inicial precisa ser maior que zero.')
    .max(MAX_STARTING_BID_CENTS, `O lance inicial pode ser de até ${formatBRL(MAX_STARTING_BID_CENTS)}.`),
  incrementCents: z
    .number('Informe o incremento mínimo em centavos, como número inteiro.')
    .int('Informe o incremento mínimo em centavos, como número inteiro.')
    .positive('O incremento mínimo precisa ser maior que zero.')
    .max(MAX_INCREMENT_CENTS, `O incremento mínimo pode ser de até ${formatBRL(MAX_INCREMENT_CENTS)}.`),
});

export const createLotInput = lotInput.extend({
  externalId: z.string().regex(/^\d{1,12}$/, 'Identificador de item inválido.'),
});

export const lotsQuery = z.object({
  status: z.enum(['live', 'scheduled', 'ended']).optional(),
  q: z.string().trim().max(100).optional(),
});
