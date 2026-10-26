import { z } from 'zod';

export const catalogSearchQuery = z.object({
  q: z.string().trim().min(2, 'Digite pelo menos 2 caracteres.').max(100),
  page: z.string().regex(/^[1-9]\d{0,8}$/, 'A página deve ser um número inteiro maior que zero.').transform(Number),
});
