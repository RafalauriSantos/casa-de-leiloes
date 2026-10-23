import { z } from 'zod';

export const depositBody = z.object({ amountCents: z.number().int() });
export const idempotencyKey = z.uuid();
