import type { ItemSummary } from './lots';

/** One page of the catalog search (B24): 12 items per page, the total is the whole collection's matches. */
export interface CatalogPage {
  items: ItemSummary[];
  total: number;
  page: number;
  pages: number;
  hasNext: boolean;
}
