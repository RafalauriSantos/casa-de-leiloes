import { z } from 'zod';
import type { ItemSummary } from '@casa/contracts';
import { AppError } from '../../shared/errors';

/**
 * Client of the Met's public collection API. Every failure of the catalog (network, timeout, 5xx,
 * an unexpected shape) becomes catalog_unavailable: it is never a fake success or an empty result.
 */
const TIMEOUT_MS = 5_000;
const SEARCH_RESULTS = 12;

const unavailable = () => new AppError('catalog_unavailable', 'O catálogo de itens está indisponível. Tente de novo em instantes.');

const searchBody = z.object({ total: z.number(), objectIDs: z.array(z.number()).nullable() });
const objectBody = z.object({
  objectID: z.number(),
  title: z.string(),
  isPublicDomain: z.boolean(),
  primaryImageSmall: z.string().optional(),
  objectURL: z.string(),
  artistDisplayName: z.string().optional(),
  objectDate: z.string().optional(),
  medium: z.string().optional(),
  department: z.string().optional(),
  culture: z.string().optional(),
});
type MetObject = z.infer<typeof objectBody>;

const orNull = (value: string | undefined): string | null => (value && value.trim() !== '' ? value : null);

/** An item we can sell: public domain and with an image. Anything else is not offered. */
function toItem(object: MetObject): ItemSummary | undefined {
  if (!object.isPublicDomain || !object.primaryImageSmall) return undefined;
  return {
    externalId: String(object.objectID),
    title: object.title,
    imageUrl: object.primaryImageSmall,
    sourceUrl: object.objectURL,
    attributes: {
      artist: orNull(object.artistDisplayName),
      date: orNull(object.objectDate),
      medium: orNull(object.medium),
      department: orNull(object.department),
      culture: orNull(object.culture),
    },
  };
}

async function request(url: string): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw unavailable();
  }
  const body: unknown = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

/** One object. 404 means "no such item" (undefined); a 5xx or a broken body is an outage. */
async function fetchObject(baseUrl: string, id: number): Promise<ItemSummary | undefined> {
  const { status, body } = await request(`${baseUrl}/v1/objects/${String(id)}`);
  if (status === 404) return undefined;
  if (status !== 200) throw unavailable();
  const parsed = objectBody.safeParse(body);
  if (!parsed.success) throw unavailable();
  return toItem(parsed.data);
}

export async function searchItems(baseUrl: string, q: string): Promise<ItemSummary[]> {
  const params = new URLSearchParams({ hasImages: 'true', isPublicDomain: 'true', q });
  const { status, body } = await request(`${baseUrl}/v1.1/search?${params.toString()}`);
  if (status !== 200) throw unavailable();
  const parsed = searchBody.safeParse(body);
  if (!parsed.success) throw unavailable();

  const ids = (parsed.data.objectIDs ?? []).slice(0, SEARCH_RESULTS);
  // Any detail that fails (outage, timeout, broken body) fails the whole search: a shorter list would
  // look like a complete answer. Only an item the catalog does not have (404) is simply left out.
  const items = await Promise.all(ids.map((id) => fetchObject(baseUrl, id)));
  return items.flatMap((item) => (item ? [item] : []));
}

/** The item a lot will copy. Used at lot creation only; nothing reads the catalog afterwards. */
export async function fetchItem(baseUrl: string, externalId: string): Promise<ItemSummary> {
  const { status, body } = await request(`${baseUrl}/v1/objects/${externalId}`);
  if (status === 404) throw new AppError('not_found', 'Item não encontrado no catálogo.');
  if (status !== 200) throw unavailable();
  const parsed = objectBody.safeParse(body);
  if (!parsed.success) throw unavailable();
  const item = toItem(parsed.data);
  if (!item) throw new AppError('validation_error', 'Este item não tem imagem pública e não pode virar lote.');
  return item;
}
