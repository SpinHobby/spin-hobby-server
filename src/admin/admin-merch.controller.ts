import { Body, Controller, Delete, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AdminLog } from '../common/admin-log.service.js';
import { AppError, notFound } from '../common/errors.js';
import { env } from '../config/env.js';
import { jsonBody, optionalString, positiveInteger, stringValue } from '../common/validation.js';
import { Db, type Queryable, type Row } from '../db/db.service.js';
import { publicProduct } from '../catalog/product.mapper.js';
import { StorageService } from '../storage/storage.service.js';
import { categoryId } from './admin-categories.controller.js';

export const isManualId = (id: string) => id.startsWith('manual-');

function priceCents(value: unknown) {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 10_000_000) throw new AppError('Enter a price above $0.');
  return cents;
}

/** null / '' = untracked (unlimited), otherwise a whole number of units. */
function stock(value: unknown) {
  if (value === null || value === '' || value === undefined) return null;
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 0 || qty > 100_000) throw new AppError('Stock must be a whole number of 0 or more.');
  return qty;
}

function imageUrls(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new AppError('Add up to 8 photos.');
  return value.map((url) => {
    const text = stringValue(url, 'image URL', 1000);
    // Production requires https; local development may use the API's own /uploads on localhost.
    const localDev = env('NODE_ENV') !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(text);
    if (!/^https:\/\//.test(text) && !localDev) throw new AppError('Photo URLs must start with https://');
    return text;
  });
}

function date(value: unknown, field: string) {
  const text = optionalString(value, 30);
  if (text && !/^\d{4}-\d{2}(-\d{2})?/.test(text)) throw new AppError(`Invalid ${field}.`);
  return text;
}

/** Hand-entered merchandise (not in Square yet) and admin photo uploads. */
@Controller('admin')
@Access('staff')
export class AdminMerchController {
  constructor(private readonly db: Db, private readonly log: AdminLog, private readonly storage: StorageService) {}

  /** The admin UI resizes photos in the browser first, then posts base64 here. */
  @Post('uploads')
  @HttpCode(200)
  async upload(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const p = jsonBody(body);
    const contentType = stringValue(p.contentType, 'contentType', 40);
    const data = stringValue(p.data, 'data', 8_000_000).replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new AppError('The image data is invalid.');
    const result = await this.storage.uploadImage(Buffer.from(data, 'base64'), contentType, p.folder === 'slides' ? 'slides' : 'products');
    await this.log.write(admin.id, 'image.uploaded', result.path, { bytes: result.bytes });
    return { success: true, ...result };
  }

  private async replaceImages(itemId: string, urls: string[], tx: Queryable) {
    await this.db.exec('delete from public.product_images where square_item_id = $1', [itemId], tx);
    for (const [i, url] of urls.entries()) {
      await this.db.exec('insert into public.product_images (square_item_id, image_url, sort_order) values ($1, $2, $3)', [itemId, url, i], tx);
    }
  }

  @Post('products')
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const p = jsonBody(body);
    const name = stringValue(p.name, 'name', 200);
    const price = priceCents(p.priceCents);
    const qty = stock(p.stockCount);
    const images = imageUrls(p.imageUrls ?? []) ?? [];
    const availability = p.availability === 'preorder' ? 'preorder' : 'auto';
    const orderBy = date(p.orderByDate, 'order-by date');
    const release = date(p.releaseMonth, 'release month');
    if (availability === 'preorder' && !orderBy) throw new AppError('Pre-orders need an order-by date.');
    const shopCategory = categoryId(p.categoryId);
    if (shopCategory && !(await this.db.one('select 1 from public.store_categories where id = $1', [shopCategory]))) throw new AppError('Category not found.', 404);
    const itemId = `manual-${randomUUID()}`;
    const variationId = `${itemId}-v`;

    await this.db.transaction(async (tx) => {
      await this.db.exec(
        `insert into public.catalog_products (square_item_id, name, description, category, category_ids, is_active, is_visible, source)
         values ($1, $2, $3, $4, '{}', true, true, 'manual')`,
        [itemId, name, optionalString(p.description, 2000), optionalString(p.category, 120)], tx,
      );
      await this.db.exec("insert into public.catalog_variations (square_variation_id, square_item_id, name, price_cents) values ($1, $2, 'Regular', $3)", [variationId, itemId, price], tx);
      await this.db.exec('update public.catalog_products set default_variation_id = $2 where square_item_id = $1', [itemId, variationId], tx);
      await this.db.exec('insert into public.inventory_snapshots (square_variation_id, quantity) values ($1, $2)', [variationId, qty], tx);
      await this.db.exec(
        `insert into public.product_metadata (square_item_id, availability, release_month, order_by_date, series, jan_code, compare_at_cents, max_per_customer, is_featured, category_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [itemId, availability, release ? `${release.slice(0, 7)}-01` : null, orderBy, optionalString(p.series, 120), optionalString(p.janCode, 20),
          p.compareAtCents ? priceCents(p.compareAtCents) : null, p.maxPerCustomer ? positiveInteger(p.maxPerCustomer, 'maxPerCustomer', 1000) : null, p.isFeatured === true, shopCategory],
        tx,
      );
      await this.replaceImages(itemId, images, tx);
      await this.log.write(admin.id, 'product.created', itemId, { name, priceCents: price, stock: qty }, tx);
    });
    const row = await this.db.one('select * from public.storefront_products where id = $1', [itemId]);
    return { success: true, product: row ? { ...publicProduct(row), source: 'manual' } : { id: itemId } };
  }

  /** Name, price, category, stock and photos — only for hand-entered products (Square owns them otherwise). */
  @Patch('products/:id/catalog')
  async update(@CurrentUser() admin: AppUser, @Param('id') itemId: string, @Body() body: unknown) {
    if (!isManualId(itemId)) throw new AppError('This product comes from Square. Edit its name, price, photos and stock in Square.');
    const p = jsonBody(body);
    const product = await this.db.one<Row>('select default_variation_id from public.catalog_products where square_item_id = $1', [itemId]);
    if (!product) throw notFound('Product');
    const changes: Row = {};
    if ('name' in p) changes.name = stringValue(p.name, 'name', 200);
    if ('category' in p) changes.category = optionalString(p.category, 120);
    if ('description' in p) changes.description = optionalString(p.description, 2000);
    const price = 'priceCents' in p ? priceCents(p.priceCents) : undefined;
    const qty = 'stockCount' in p ? stock(p.stockCount) : undefined;
    const images = imageUrls(p.imageUrls);
    await this.db.transaction(async (tx) => {
      const keys = Object.keys(changes);
      if (keys.length) {
        await this.db.exec(`update public.catalog_products set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where square_item_id = $1`, [itemId, ...keys.map((k) => changes[k])], tx);
      }
      if (price !== undefined) await this.db.exec('update public.catalog_variations set price_cents = $2 where square_variation_id = $1', [product.default_variation_id, price], tx);
      if (qty !== undefined) {
        await this.db.exec(
          `insert into public.inventory_snapshots (square_variation_id, quantity, synced_at) values ($1, $2, now())
           on conflict (square_variation_id) do update set quantity = excluded.quantity, synced_at = now()`,
          [product.default_variation_id, qty], tx,
        );
      }
      if (images) await this.replaceImages(itemId, images, tx);
      await this.log.write(admin.id, 'product.catalog_updated', itemId, { ...changes, priceCents: price, stockCount: qty, images: images?.length }, tx);
    });
    return { success: true };
  }

  @Delete('products/:id')
  async archive(@CurrentUser() admin: AppUser, @Param('id') itemId: string) {
    if (!isManualId(itemId)) throw new AppError('This product comes from Square. Archive it in Square instead.');
    await this.db.exec('update public.catalog_products set is_active = false where square_item_id = $1', [itemId]);
    await this.log.write(admin.id, 'product.archived', itemId);
    return { success: true };
  }
}
