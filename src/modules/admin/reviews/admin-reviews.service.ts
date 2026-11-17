import { Injectable } from '@nestjs/common';
import { notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import type { ProductReviewRow } from '../../../database/rows.js';
import { AdminLog } from '../admin-log.service.js';
import type { ModerateReviewDto } from './dto/moderate-review.dto.js';

type ReviewForStaff = ProductReviewRow & { product_name: string | null; billing_email: string };

/** Admin > Reviews: shoppers' reviews waiting for a decision, and the ones already decided. */
@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** Waiting reviews oldest first (first come, first answered); decided ones newest first. */
  async list(status: 'pending' | 'approved' | 'rejected') {
    const rows = await this.db.many<ReviewForStaff>(
      `select r.*, p.name as product_name, o.billing_email from public.product_reviews r
         join public.orders o on o.id = r.order_id
         left join public.storefront_products p on p.id = r.square_item_id
        where r.status = $1
        order by case when $1 = 'pending' then r.created_at end asc, r.created_at desc
        limit 200`,
      [status],
    );
    const pending = await this.db.one<{ n: string }>(
      "select count(*) n from public.product_reviews where status = 'pending'",
    );
    return {
      pendingCount: Number(pending?.n ?? 0),
      reviews: rows.map((r) => ({
        id: r.id,
        itemId: r.square_item_id,
        productName: r.product_name,
        orderId: r.order_id,
        email: r.billing_email,
        authorName: r.author_name,
        rating: r.rating,
        title: r.title,
        body: r.body,
        reply: r.reply,
        status: r.status,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
      })),
    };
  }

  async moderate(adminId: string, id: string, dto: ModerateReviewDto) {
    const review = await this.db.one<ProductReviewRow>(
      `update public.product_reviews set status = $2, reply = $3, reviewed_at = case when $2 = 'pending' then null else now() end
        where id = $1 returning *`,
      [id, dto.status, dto.reply],
    );
    if (!review) throw notFound('Review');
    await this.log.write(adminId, `review.${dto.status}`, id, {
      itemId: review.square_item_id,
      rating: review.rating,
      reply: !!dto.reply,
    });
    return { id: review.id, status: review.status, reply: review.reply };
  }
}
