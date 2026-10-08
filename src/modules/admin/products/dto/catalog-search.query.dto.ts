import { IsOptional } from 'class-validator';

/**
 * Search, filters, sorting and paging for `GET /admin/catalog`. Values are checked by CatalogSearchService,
 * which answers 400 for an unknown status, source, sort, direction or category rather than ignoring them.
 */
export class CatalogSearchQuery {
  /** Search text. Every word must match the name, series, character, maker, JAN, category, SKU or a Square id. */
  @IsOptional()
  q?: string | null;

  /** Comma-separated: `in`, `low`, `out`, `pre`, `closed`, `unavailable`, `hidden`, `retired`. */
  @IsOptional()
  status?: string | null;

  /** `square` or `manual`. */
  @IsOptional()
  source?: string | null;

  /** A shop category id (includes its subcategories), or `none` for uncategorised. */
  @IsOptional()
  categoryId?: string | null;

  /** A series id, or `none` for products with no series. */
  @IsOptional()
  seriesId?: string | null;

  /** `1` to show only featured products. */
  @IsOptional()
  featured?: string | null;

  /** `1` to show only products with customers waiting for a restock alert. */
  @IsOptional()
  alerts?: string | null;

  /** `1` to show only products without a photo. */
  @IsOptional()
  noPhoto?: string | null;

  /** Lowest price in dollars. */
  @IsOptional()
  min?: string | null;

  /** Highest price in dollars. */
  @IsOptional()
  max?: string | null;

  /** `name`, `price`, `stock`, `category`, `status`, `updated`, `created`, `release` or `alerts`. */
  @IsOptional()
  sort?: string | null;

  /** `asc` or `desc`. Defaults to A-Z for text sorts and biggest/newest first for the rest. */
  @IsOptional()
  dir?: string | null;

  /** Page size, 1 to 100 (default 50). */
  @IsOptional()
  limit?: string | null;

  /** Where to continue from: the `cursor` of the previous page. */
  @IsOptional()
  cursor?: string | null;
}
