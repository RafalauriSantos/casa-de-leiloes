/**
 * Hits the real Met API (not the captured stub). Not part of `make ci`: it needs the internet and the
 * Met's own availability. Run before each deploy and before submitting: `make e2e-live`.
 */
import { fetchItem, searchItems } from '../src/modules/catalog/met-client';

const BASE = 'https://collectionapi.metmuseum.org/public/collection';

const { items } = await searchItems(BASE, 'vase', 1);
if (items.length === 0) throw new Error('live check: the Met returned no public-domain items with images for "vase"');
for (const item of items) {
  if (!item.imageUrl.startsWith('https://')) throw new Error(`live check: item ${item.externalId} has no https image`);
}
console.log(`search "vase": ${String(items.length)} items with images, first: ${items[0]?.externalId ?? '-'} "${items[0]?.title ?? ''}"`);

const first = items[0];
if (!first) throw new Error('live check: nothing to copy');
const copy = await fetchItem(BASE, first.externalId);
if (copy.title !== first.title) throw new Error('live check: the copied title differs from the search result');
console.log(`copy of ${copy.externalId}: ${copy.title} · ${copy.attributes.artist ?? 'no artist'} · ${copy.sourceUrl}`);
console.log('live check OK');
