import { IsOptional } from 'class-validator';

/**
 * The filters, sort and paging of a product list. Every field is optional and lenient on purpose: a bad
 * number or an unknown sort falls back to the default instead of failing the page (CatalogService decides).
 */
export class ProductQuery {
  /** Page size, 1 to 60 (default 24). */
  @IsOptional()
  limit?: string | null;

  /** Where to continue from: the `cursor` of the previous page. */
  @IsOptional()
  cursor?: string | null;

  /** Square category name. */
  @IsOptional()
  category?: string | null;

  /** Comma-separated statuses: `in`, `low`, `out`, `pre`, `closed`. */
  @IsOptional()
  status?: string | null;

  /** `featured`, `new`, `release`, `price_asc`, `price_desc` or `pop`. */
  @IsOptional()
  sort?: string | null;

  /** Lowest price in dollars. */
  @IsOptional()
  min?: string | null;

  /** Highest price in dollars (exclusive). */
  @IsOptional()
  max?: string | null;

  /** Search text: name, series, character, JAN code or category. */
  @IsOptional()
  q?: string | null;

  /** Shop category id: matches the category and everything beneath it. */
  @IsOptional()
  categoryId?: string | null;

  /** Storefront menu section: `new`, `preorders`, `sale`, `figures`, `plushies`, `cards`, `goods` or `media`. */
  @IsOptional()
  group?: string | null;

  /** A series by its address form (`re-zero` for "Re:Zero"): the storefront's /series/<slug> pages. */
  @IsOptional()
  series?: string | null;

  /** Comma-separated product ids (e.g. the shopper's wishlist). */
  @IsOptional()
  ids?: string | null;
}
