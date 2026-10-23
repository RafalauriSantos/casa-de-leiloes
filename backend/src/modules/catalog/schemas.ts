import { z } from 'zod';

export const catalogSearchQuery = z.object({
  q: z.string().trim().min(2, 'Digite pelo menos 2 caracteres.').max(100),
});
