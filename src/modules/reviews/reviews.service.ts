import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { ProductReviewRow } from '../../database/rows.js';
import type { AppUser } from '../auth/auth.service.js';
import type { CreateReviewDto } from './dto/create-review.dto.js';

/** Orders whose items the shopper has (or is about to have) in hand: a reserved pre-order hasn't arrived, a refund is no longer theirs. */
const REVIEWABLE = `('paid', 'fulfilled', 'shipped')`;

/** How a review appears on the shop: no order, email or account. */
export const publicReview = (r: ProductReviewRow) => ({
  id: r.id,
  authorName: r.author_name,
  rating: r.rating,
  title: r.title,
  body: r.body,
  reply: r.reply,
  createdAt: r.created_at,
});

/** Reviews from verified buyers: written by shoppers, shown once staff approve them (Admin > Reviews). */
@Injectable()
export class ReviewsService {
  constructor(private readonly db: Db) {}

  /** A product's approved reviews, newest first, with the star summary the product page shows. */
  async forProduct(itemId: string) {
    const rows = await this.db.many<ProductReviewRow>(
      `select * from public.product_reviews where square_item_id = $1 and status = 'approved'
        order by created_at desc limit 50`,
      [itemId],
    );
    const counts = await this.db.many<{ rating: number; n: string }>(
      `select rating, count(*) n from public.product_reviews where square_item_id = $1 and status = 'approved' group by rating`,
      [itemId],
    );
    const stars = [5, 4, 3, 2, 1].map((s) => Number(counts.find((c) => c.rating === s)?.n ?? 0));
    const count = stars.reduce((a, b) => a + b, 0);
    const average = count ? stars.reduce((sum, n, i) => sum + n * (5 - i), 0) / count : null;
    return {
      summary: { count, average: average == null ? null : Math.round(average * 10) / 10, stars },
      items: rows.map(publicReview),
    };
  }

  /**
   * Saves a review for staff to approve. The order must hold the item and be paid; a guest's order number and email are checked
   * together and a wrong pair is answered the same way as an unknown one, so it can't be used to find orders.
   */
  async create(user: AppUser | null, dto: CreateReviewDto) {
    let orderId: number | undefined;
    if (dto.orderId != null || dto.email != null) {
      if (dto.orderId == null || dto.email == null)
        throw new AppError('Give both your order number and the email you ordered with.');
      orderId = (
        await this.db.one<{ id: number }>(
          `select o.id from public.orders o
            where o.id = $1 and lower(o.billing_email) = $2 and o.status in ${REVIEWABLE}
              and exists (select 1 from public.order_items i where i.order_id = o.id and i.square_item_id = $3)`,
          [dto.orderId, dto.email.toLowerCase(), dto.itemId],
        )
      )?.id;
      if (!orderId)
        throw new AppError(
          "We couldn't find a paid order of this item with that number and email.",
          404,
        );
    } else if (user) {
      // the newest paid order of the item not reviewed yet
      orderId = (
        await this.db.one<{ id: number }>(
          `select o.id from public.orders o
            where o.user_id = $1 and o.status in ${REVIEWABLE}
              and exists (select 1 from public.order_items i where i.order_id = o.id and i.square_item_id = $2)
              and not exists (select 1 from public.product_reviews r where r.order_id = o.id and r.square_item_id = $2)
            order by o.created_at desc limit 1`,
          [user.id, dto.itemId],
        )
      )?.id;
      if (!orderId)
        throw new AppError(
          "Your account has no paid order of this item to review yet (or you've reviewed it already).",
          404,
        );
    } else {
      throw new AppError('Sign in, or give your order number and email.');
    }

    const review = await this.db.one<ProductReviewRow>(
      `insert into public.product_reviews (square_item_id, order_id, user_id, author_name, rating, title, body)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (order_id, square_item_id) do nothing returning *`,
      [dto.itemId, orderId, user?.id ?? null, dto.name, dto.rating, dto.title, dto.body],
    );
    if (!review) throw new AppError("You've already reviewed this item from that order.", 409);
    return { id: review.id, status: review.status };
  }
}
