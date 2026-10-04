import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../../../common/errors.js';
import { Db, type Queryable, type Row } from '../../../database/db.service.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { publicProduct } from '../../catalog/product.mapper.js';
import { isManualId } from '../../catalog/manual-id.js';
import { AdminLog } from '../admin-log.service.js';
import { sentFields } from '../dto/defined-fields.js';
import type { CreateManualProductDto } from './dto/create-manual-product.dto.js';
import type { UpdateManualProductDto } from './dto/update-manual-product.dto.js';
import type { UploadImageDto } from './dto/upload-image.dto.js';

const SQUARE_OWNED =
  'This product comes from Square. Edit its name, price, photos and stock in Square.';

/**
 * Hand-entered products: items the shop sells that aren't in Square. We own their name, price, photos and
 * stock (Square items are the other way round), and their ids start with "manual-".
 */
@Injectable()
export class AdminMerchService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
    private readonly storage: StorageService,
  ) {}

  /** Stores a photo the admin resized in the browser. Returns its public URL. */
  async uploadImage(adminId: string, dto: UploadImageDto) {
    const result = await this.storage.uploadImage(
      Buffer.from(dto.data, 'base64'),
      dto.contentType,
      dto.folder,
    );
    await this.log.write(adminId, 'image.uploaded', result.path, { bytes: result.bytes });
    return result;
  }

  private async replaceImages(itemId: string, urls: string[], tx: Queryable) {
    await this.db.exec('delete from public.product_images where square_item_id = $1', [itemId], tx);
    for (const [position, url] of urls.entries()) {
      await this.db.exec(
        'insert into public.product_images (square_item_id, image_url, sort_order) values ($1, $2, $3)',
        [itemId, url, position],
        tx,
      );
    }
  }

  /** Creates the product, its single "Regular" variation, stock, storefront details and photos together. */
  async create(adminId: string, dto: CreateManualProductDto) {
    if (dto.availability === 'preorder' && !dto.orderByDate)
      throw new AppError('Pre-orders need an order-by date.');
    if (
      dto.categoryId &&
      !(await this.db.one('select 1 from public.store_categories where id = $1', [dto.categoryId]))
    )
      throw new AppError('Category not found.', 404);
    const itemId = `manual-${randomUUID()}`;
    const variationId = `${itemId}-v`;

    await this.db.transaction(async (tx) => {
      await this.db.exec(
        `insert into public.catalog_products (square_item_id, name, description, category, category_ids, is_active, is_visible, source)
         values ($1, $2, $3, $4, '{}', true, true, 'manual')`,
        [itemId, dto.name, dto.description, dto.category],
        tx,
      );
      await this.db.exec(
        "insert into public.catalog_variations (square_variation_id, square_item_id, name, price_cents) values ($1, $2, 'Regular', $3)",
        [variationId, itemId, dto.priceCents],
        tx,
      );
      await this.db.exec(
        'update public.catalog_products set default_variation_id = $2 where square_item_id = $1',
        [itemId, variationId],
        tx,
      );
      await this.db.exec(
        'insert into public.inventory_snapshots (square_variation_id, quantity) values ($1, $2)',
        [variationId, dto.stockCount],
        tx,
      );
      await this.db.exec(
        `insert into public.product_metadata (square_item_id, availability, release_month, order_by_date, series, jan_code, compare_at_cents, max_per_customer, is_featured, category_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          itemId,
          dto.availability,
          dto.releaseMonth ? `${dto.releaseMonth.slice(0, 7)}-01` : null,
          dto.orderByDate,
          dto.series,
          dto.janCode,
          dto.compareAtCents,
          dto.maxPerCustomer,
          dto.isFeatured,
          dto.categoryId,
        ],
        tx,
      );
      await this.replaceImages(itemId, dto.imageUrls, tx);
      await this.log.write(
        adminId,
        'product.created',
        itemId,
        { name: dto.name, priceCents: dto.priceCents, stock: dto.stockCount },
        tx,
      );
    });
    const row = await this.db.one('select * from public.storefront_products where id = $1', [
      itemId,
    ]);
    return row ? { ...publicProduct(row), source: 'manual' } : { id: itemId };
  }

  /** Saves the fields that were sent. Only for hand-entered products. */
  async update(adminId: string, itemId: string, dto: UpdateManualProductDto) {
    if (!isManualId(itemId)) throw new AppError(SQUARE_OWNED);
    const product = await this.db.one<Row>(
      'select default_variation_id from public.catalog_products where square_item_id = $1',
      [itemId],
    );
    if (!product) throw notFound('Product');
    const { name, category, description, priceCents, stockCount, imageUrls } = dto;
    const changes = sentFields({ name, category, description });
    await this.db.transaction(async (tx) => {
      const columns = Object.keys(changes);
      if (columns.length) {
        await this.db.exec(
          `update public.catalog_products set ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} where square_item_id = $1`,
          [itemId, ...columns.map((c) => changes[c])],
          tx,
        );
      }
      if (priceCents !== undefined) {
        await this.db.exec(
          'update public.catalog_variations set price_cents = $2 where square_variation_id = $1',
          [product.default_variation_id, priceCents],
          tx,
        );
      }
      if (stockCount !== undefined) {
        await this.db.exec(
          `insert into public.inventory_snapshots (square_variation_id, quantity, synced_at) values ($1, $2, now())
           on conflict (square_variation_id) do update set quantity = excluded.quantity, synced_at = now()`,
          [product.default_variation_id, stockCount],
          tx,
        );
      }
      if (imageUrls) await this.replaceImages(itemId, imageUrls, tx);
      await this.log.write(
        adminId,
        'product.catalog_updated',
        itemId,
        { ...changes, priceCents, stockCount, images: imageUrls?.length },
        tx,
      );
    });
  }

  /** Takes the product off the storefront (it stays in the database for past orders). */
  async archive(adminId: string, itemId: string) {
    if (!isManualId(itemId))
      throw new AppError('This product comes from Square. Archive it in Square instead.');
    await this.db.exec(
      'update public.catalog_products set is_active = false where square_item_id = $1',
      [itemId],
    );
    await this.log.write(adminId, 'product.archived', itemId);
  }
}
