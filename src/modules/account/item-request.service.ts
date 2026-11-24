import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';

/** "Ask us to find one": a shopper asks for another of a sold item. Guests leave an email; signed-in customers are linked to it. */
@Injectable()
export class ItemRequestService {
  constructor(private readonly db: Db) {}

  /** Asking twice while the first request waits keeps the one request (the newer note replaces an empty one). */
  async ask(email: string, productId: string, note: string | null, userId: string | null) {
    const product = await this.db.one<{ name: string; status: string }>(
      'select name, status from public.storefront_products where id = $1',
      [productId],
    );
    if (!product) throw notFound('Product');
    if (!['out', 'closed'].includes(product.status))
      throw new AppError('This item can be bought now: no need to ask.');
    await this.db.exec(
      `insert into public.item_requests (square_item_id, product_name, email, user_id, note)
       values ($1, $2, $3, $4, $5)
       on conflict (square_item_id, lower(email)) where status = 'waiting'
       do update set note = coalesce(excluded.note, item_requests.note),
                     user_id = coalesce(excluded.user_id, item_requests.user_id)`,
      [productId, product.name, email, userId, note],
    );
  }
}
