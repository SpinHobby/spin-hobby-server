import { IsOptional } from 'class-validator';
import { ProductQuery } from '../../../catalog/dto/product-query.dto.js';

/** The storefront filters, plus a quick filter the admin product list uses. */
export class AdminProductsQuery extends ProductQuery {
  /** `all`, `in` (in or low stock), `low` (low or sold out), `pre` (pre-orders) or `featured`. */
  @IsOptional()
  filter?: string;
}
