import { Injectable } from '@nestjs/common';
import { AppError, errorText, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { squareAccessToken, squareLocationId } from '../../../config/square.config.js';
import { SquareCatalogClient } from '../../../integrations/square/square-catalog.client.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { cropToArtworkRegion } from '../../cashier/image-processing.js';
import { SquareSyncService } from '../../square-sync/square-sync.service.js';
import { AdminLog } from '../admin-log.service.js';
import { downloadPhoto } from './download-photo.js';
import type { QuickAddDto } from './dto/quick-add.dto.js';

/** Square's own message, shown instead of a generic server error. */
function fromSquare(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new AppError(`Square said: ${errorText(error)}`, 502);
}

export interface ExistingProduct {
  id: string;
  name: string;
  source: 'square' | 'manual';
  stockCount: number | null;
  isActive: boolean;
}

/**
 * Adding a product the new way: it is created in Square (name, description, price, barcode, category, polished
 * photos, starting stock), brought into our database straight away, and given its storefront details. If any
 * step fails the Square copy is removed again, so a failed add leaves nothing behind.
 */
@Injectable()
export class QuickAddService {
  constructor(
    private readonly db: Db,
    private readonly square: SquareCatalogClient,
    private readonly sync: SquareSyncService,
    private readonly storage: StorageService,
    private readonly log: AdminLog,
  ) {}

  /** The product that already carries this barcode (in Square's data or in our own JAN field), if any. */
  async findByBarcode(code: string): Promise<ExistingProduct | null> {
    const row = await this.db.one<{
      id: string;
      name: string;
      source: 'square' | 'manual';
      stock: number | null;
      is_active: boolean;
    }>(
      `select p.square_item_id as id, p.name, p.source, p.is_active, i.quantity as stock
         from public.catalog_products p
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
         left join public.product_metadata m on m.square_item_id = p.square_item_id
        where p.replaced_by is null and (v.upc = $1 or m.jan_code = $1)
        order by p.is_active desc, p.created_at limit 1`,
      [code],
    );
    return row
      ? {
          id: row.id,
          name: row.name,
          source: row.source,
          stockCount: row.stock,
          isActive: row.is_active,
        }
      : null;
  }

  /** Adds units to the stock of a Square product (a restock of something already listed). Returns the new count. */
  async addStock(adminId: string, itemId: string, quantity: number): Promise<number> {
    const product = await this.db.one<{ source: string; variation_id: string | null }>(
      'select source, default_variation_id as variation_id from public.catalog_products where square_item_id = $1',
      [itemId],
    );
    if (!product) throw notFound('Product');
    if (product.source !== 'square' || !product.variation_id)
      throw new AppError(
        'Only Square products can be restocked here. Edit this one in its drawer.',
      );
    const current =
      (await this.square.getInventoryCounts([product.variation_id]).catch(fromSquare))[
        product.variation_id
      ] ?? 0;
    const next = current + quantity;
    await this.square.setInitialInventoryCount(product.variation_id, next).catch(fromSquare);
    await this.sync.syncItems([itemId]).catch(fromSquare);
    await this.log.write(adminId, 'product.stock_added', itemId, { quantity, next });
    return next;
  }

  async add(adminId: string, dto: QuickAddDto) {
    if (!squareAccessToken() || !squareLocationId())
      throw new AppError('Square is not connected, so products cannot be added there yet.', 503);
    if (dto.availability === 'preorder' && !dto.orderByDate)
      throw new AppError('Pre-orders need an order-by date.');
    if (
      dto.categoryId &&
      !(await this.db.one('select 1 from public.store_categories where id = $1', [dto.categoryId]))
    )
      throw new AppError('Category not found.', 404);

    // Read every photo first: if one cannot be read nothing has been created yet.
    const buffers = await Promise.all(dto.imageUrls.map((url) => downloadPhoto(url)));
    if (dto.artworkCrop && buffers.length)
      buffers[0] = await cropToArtworkRegion(buffers[0], dto.artworkCrop);

    const squareCategoryId = dto.category?.trim()
      ? await this.square.getOrCreateCategoryId(dto.category.trim()).catch(() => undefined)
      : undefined;
    const created = await this.square
      .createLocationItem({
        name: dto.name,
        description: dto.description ?? undefined,
        price: dto.priceCents,
        hidden: dto.hidden,
        categoryId: squareCategoryId,
        upc: dto.barcode ?? dto.janCode ?? undefined,
      })
      .catch(fromSquare);
    const itemId = created?.id as string | undefined;
    const variationId = created?.item_data?.variations?.[0]?.id as string | undefined;
    if (!itemId || !variationId) throw new AppError('Square did not return the new item.', 502);

    try {
      if (buffers.length) {
        const saved = await this.square.attachPhotos(itemId, dto.name, buffers);
        if (saved < buffers.length)
          throw new AppError(`Square accepted only ${saved} of ${buffers.length} photos.`, 502);
      }
      if (dto.stockCount != null)
        await this.square.setInitialInventoryCount(variationId, dto.stockCount).catch(fromSquare);
      await this.sync.syncItems([itemId]).catch(fromSquare);
      await this.checkCopy(itemId, dto, buffers.length);
      await this.saveStorefrontDetails(itemId, dto);
    } catch (error) {
      await this.undo(itemId);
      throw error instanceof AppError
        ? new AppError(
            `${error.message} Nothing was added: your photos and details are still here, so try again.`,
            error.status,
          )
        : error;
    }

    // The photos now live in Square; the temporary copies we stored for the upload are not needed.
    await this.storage.deleteImages(dto.imageUrls).catch(() => undefined);
    await this.log.write(adminId, 'product.added_to_square', itemId, {
      name: dto.name,
      photos: buffers.length,
    });
    return { id: itemId, name: dto.name, photos: buffers.length };
  }

  /** What our database now holds for the new item must match what was entered. */
  private async checkCopy(itemId: string, dto: QuickAddDto, photoCount: number) {
    const copy = await this.db.one<{
      name: string;
      price_cents: number | null;
      stock: number | null;
      photos: number;
    }>(
      `select p.name, v.price_cents, i.quantity as stock,
              (select count(*)::int from public.product_images pi where pi.square_item_id = p.square_item_id) as photos
         from public.catalog_products p
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
        where p.square_item_id = $1 and p.source = 'square'`,
      [itemId],
    );
    const problems: string[] = [];
    if (!copy) problems.push('it did not arrive from Square');
    else {
      if (copy.name.trim() !== dto.name.trim()) problems.push('the name differs');
      if (Number(copy.price_cents) !== dto.priceCents) problems.push('the price differs');
      if (dto.stockCount != null && Number(copy.stock ?? NaN) !== dto.stockCount)
        problems.push('the stock differs');
      if (copy.photos < photoCount)
        problems.push(`only ${copy.photos} of ${photoCount} photos arrived`);
    }
    if (problems.length)
      throw new AppError(`The new Square item did not match (${problems.join(', ')}).`, 502);
  }

  /** Series, shop category, pre-order dates and the other details only the storefront keeps. */
  private async saveStorefrontDetails(itemId: string, dto: QuickAddDto) {
    await this.db.transaction(async (tx) => {
      const last = dto.isFeatured
        ? await this.db.one<{ next: number }>(
            'select coalesce(max(sort_order), 0) + 1 as next from public.product_metadata where is_featured',
            [],
            tx,
          )
        : null;
      await this.db.exec(
        `insert into public.product_metadata
           (square_item_id, series, jan_code, category_id, availability, order_by_date, release_month,
            compare_at_cents, max_per_customer, is_featured, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (square_item_id) do update set series = excluded.series, jan_code = excluded.jan_code,
           category_id = excluded.category_id, availability = excluded.availability,
           order_by_date = excluded.order_by_date, release_month = excluded.release_month,
           compare_at_cents = excluded.compare_at_cents, max_per_customer = excluded.max_per_customer,
           is_featured = excluded.is_featured, sort_order = excluded.sort_order`,
        [
          itemId,
          dto.series,
          dto.barcode ?? dto.janCode,
          dto.categoryId,
          dto.availability,
          dto.orderByDate,
          dto.releaseMonth,
          dto.compareAtCents,
          dto.maxPerCustomer,
          dto.isFeatured,
          last?.next ?? 0,
        ],
        tx,
      );
    });
  }

  /** Takes the half-made item out of Square and out of our copy of it. Best effort: it reports nothing itself. */
  private async undo(itemId: string) {
    try {
      await this.square.deleteItem(itemId);
      await this.db.exec(
        "delete from public.catalog_products where square_item_id = $1 and source = 'square'",
        [itemId],
      );
    } catch {
      /* the next sync shows it, and it can be deleted in Square */
    }
  }
}
