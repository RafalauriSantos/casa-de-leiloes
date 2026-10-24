import { z } from 'zod';


/** A bid can never exceed the bidder's balance; this ceiling only bounds the input. */
const MAX_BID_CENTS = 1_000_000_000_000;

export const bidBody = z.object({
  amountCents: z.number().int().positive().max(MAX_BID_CENTS),
});
