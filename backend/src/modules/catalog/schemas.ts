import { z } from 'zod';

export const catalogSearchQuery = z.object({
  // Empty means the featured items; any other query must have at least two characters.
  q: z.string().trim().max(100).refine((value) => value === '' || value.length >= 2, 'Digite pelo menos 2 caracteres.'),
  page: z.string().regex(/^[1-9]\d{0,8}$/, 'A página deve ser um número inteiro maior que zero.').transform(Number),
});
