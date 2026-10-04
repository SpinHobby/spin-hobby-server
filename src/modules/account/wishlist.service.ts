import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import type { StorefrontProductRow } from '../../database/rows.js';
import { Db } from '../../database/db.service.js';
import { publicProduct } from '../catalog/product.mapper.js';

/** A signed-in customer's saved products. */
@Injectable()
export class WishlistService {
  constructor(private readonly db: Db) {}

  /** Newest first, in the same shape as the storefront catalog (products that are no longer for sale drop out). */
  async list(userId: string) {
    const rows = await this.db.many<StorefrontProductRow>(
      `select p.* from public.wishlist_items w
         join public.storefront_products p on p.id = w.square_item_id
        where w.user_id = $1 order by w.created_at desc`,
      [userId],
    );
    return rows.map(publicProduct);
  }

  async add(userId: string, squareItemId: string) {
    const product = await this.db.one('select id from public.storefront_products where id = $1', [
      squareItemId,
    ]);
    if (!product) throw new AppError('This product is not available.');
    await this.db.exec(
      'insert into public.wishlist_items (user_id, square_item_id) values ($1, $2) on conflict do nothing',
      [userId, squareItemId],
    );
  }

  async remove(userId: string, squareItemId: string) {
    await this.db.exec(
      'delete from public.wishlist_items where user_id = $1 and square_item_id = $2',
      [userId, squareItemId],
    );
  }
}
