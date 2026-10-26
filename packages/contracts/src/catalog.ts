import type { ItemSummary } from './lots';

/** Items per page of the catalog search (B24). */
export const CATALOG_PAGE_SIZE = 12;
/** The Met answers at most this many results per search: the rest of the collection cannot be reached through it (D28). */
export const CATALOG_SEARCH_WINDOW = 10_000;

/** One page of the catalog search: `total` is every match the Met has, `pages` counts only the reachable ones. */
export interface CatalogPage {
  items: ItemSummary[];
  total: number;
  page: number;
  pages: number;
  hasNext: boolean;
}
