import { Injectable } from '@nestjs/common';
import { AppError, errorText, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import type { CatalogProductRow } from '../../../database/rows.js';
import { SquareCatalogClient } from '../../../integrations/square/square-catalog.client.js';
import { squareAccessToken, squareLocationId } from '../../../config/square.config.js';
import { PhotoCleanupService } from '../../catalog/photo-cleanup.service.js';
import { SquareSyncService } from '../../square-sync/square-sync.service.js';
import { AdminLog } from '../admin-log.service.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** What the move needs to know about a hand-entered product. */
interface LocalProduct extends Pick<
  CatalogProductRow,
  'square_item_id' | 'name' | 'description' | 'category' | 'source' | 'is_active' | 'is_visible'
> {
  default_variation_id: string | null;
  replaced_by: string | null;
  price_cents: number | null;
  stock: number | null;
  availability: string | null;
}

/** Square's own message, shown to the admin instead of a generic server error. */
function fromSquare(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new AppError(`Square said: ${errorText(error)}`, 502);
}

/**
 * Two things an admin can do to a product from the Products list:
 *  - show or hide it on the website (for a Square product the change is made in Square too, so the two stay in step);
 *  - move a hand-entered product into Square, which frees the space its photos used in our storage.
 */
@Injectable()
export class ProductTransferService {
  private readonly moving = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly square: SquareCatalogClient,
    private readonly sync: SquareSyncService,
    private readonly photos: PhotoCleanupService,
    private readonly log: AdminLog,
  ) {}

  /**
   * Shows or hides a product on the website. Square products get (or lose) the "hidden from the website"
   * category in Square itself, so Square and our database always agree; hand-entered products are updated here.
   */
  async setVisible(adminId: string, itemId: string, visible: boolean) {
    const product = await this.db.one<Pick<CatalogProductRow, 'source' | 'is_active'>>(
      'select source, is_active from public.catalog_products where square_item_id = $1',
      [itemId],
    );
    if (!product) throw notFound('Product');
    if (!product.is_active) throw new AppError('This product is retired, so it cannot be shown.');

    if (product.source === 'square') {
      const categoryIds = await this.square.setItemHidden(itemId, !visible).catch(fromSquare);
      await this.db.exec(
        'update public.catalog_products set is_visible = $2, category_ids = $3 where square_item_id = $1',
        [itemId, visible, categoryIds],
      );
    } else {
      await this.db.exec(
        'update public.catalog_products set is_visible = $2 where square_item_id = $1',
        [itemId, visible],
      );
    }
    // The older "Hidden" availability setting would keep the product off the shop; showing means showing.
    if (visible) {
      await this.db.exec(
        "update public.product_metadata set availability = 'auto' where square_item_id = $1 and availability = 'hidden'",
        [itemId],
      );
    }
    await this.log.write(adminId, visible ? 'product.shown' : 'product.hidden', itemId, {
      source: product.source,
    });
    return { visible };
  }

  /**
   * Moves a hand-entered product into Square:
   *  1. creates it there (name, description, price, category, photos, stock),
   *  2. brings the new Square item into our database,
   *  3. carries over what only we hold (series, JAN, featured, shop category, wishlists, restock alerts),
   *  4. retires the old hand-entered row and deletes its photos from our storage.
   * Square gives the product a new id; the old id stays on past orders. If it stops half way, running it again
   * continues where it stopped (it never creates a second copy in Square).
   */
  async transferToSquare(adminId: string, itemId: string) {
    if (!squareAccessToken() || !squareLocationId())
      throw new AppError('Square is not connected, so products cannot be moved there yet.', 503);
    if (this.moving.has(itemId)) throw new AppError('This product is already being moved.', 409);
    this.moving.add(itemId);
    try {
      const product = await this.loadLocal(itemId);
      if (!product.is_active) {
        // Already moved: report where it went and make sure nothing is left over. Never touches Square again
        // (that would reset its stock to the old number).
        if (!product.replaced_by)
          throw new AppError('This product is retired, so it cannot be moved.');
        const photosRemoved = await this.photos.purgeReplacedProducts().catch(() => 0);
        return {
          id: product.replaced_by,
          name: product.name,
          photosMoved: 0,
          photosRemoved,
          alreadyMoved: true,
        };
      }

      const photoUrls = (
        await this.db.many<{ image_url: string }>(
          'select image_url from public.product_images where square_item_id = $1 order by sort_order',
          [itemId],
        )
      ).map((p) => p.image_url);

      // A copy left in Square by an earlier attempt is reused, unless it has been removed since.
      let squareId = product.replaced_by;
      if (squareId && !(await this.square.getItem(squareId).catch(() => null))?.item) {
        await this.db.exec(
          'update public.catalog_products set replaced_by = null where square_item_id = $1',
          [itemId],
        );
        squareId = null;
      }
      squareId ??= await this.createInSquare(product);
      try {
        await this.addPhotosAndStock(squareId, product, photoUrls);
        await this.sync.syncItems([squareId]).catch(fromSquare);
        await this.verifyCopy(product, squareId, photoUrls.length);
        await this.carryOver(product, squareId);
      } catch (error) {
        throw await this.revert(product, squareId, error);
      }

      let photosRemoved = 0;
      try {
        photosRemoved = await this.photos.purgeReplacedProducts();
      } catch {
        /* the next sync retries; the move itself is done */
      }
      await this.log.write(adminId, 'product.moved_to_square', itemId, {
        squareId,
        photos: photoUrls.length,
      });
      return {
        id: squareId,
        name: product.name,
        photosMoved: photoUrls.length,
        photosRemoved,
        alreadyMoved: false,
      };
    } finally {
      this.moving.delete(itemId);
    }
  }

  private async loadLocal(itemId: string): Promise<LocalProduct> {
    const product = await this.db.one<LocalProduct>(
      `select p.square_item_id, p.name, p.description, p.category, p.source, p.is_active, p.is_visible,
              p.default_variation_id, p.replaced_by, v.price_cents, i.quantity as stock, m.availability
         from public.catalog_products p
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
         left join public.product_metadata m on m.square_item_id = p.square_item_id
        where p.square_item_id = $1`,
      [itemId],
    );
    if (!product) throw notFound('Product');
    if (product.source !== 'manual')
      throw new AppError('Only products kept in our own database can be moved into Square.');
    if (product.price_cents == null) throw new AppError('This product has no price to move.');
    return product;
  }

  /** Step 1: the item in Square, and a note on our row saying where it went (so a retry never makes a second copy). */
  private async createInSquare(product: LocalProduct): Promise<string> {
    let categoryId: string | undefined;
    if (product.category?.trim()) {
      categoryId = await this.square
        .getOrCreateCategoryId(product.category.trim())
        .catch(() => undefined);
    }
    const created = await this.square
      .createLocationItem({
        name: product.name,
        description: product.description ?? undefined,
        price: Number(product.price_cents),
        hidden: !product.is_visible || product.availability === 'hidden',
        categoryId,
      })
      .catch(fromSquare);
    if (!created?.id) throw new AppError('Square did not return the new item.', 502);
    try {
      await this.db.exec(
        'update public.catalog_products set replaced_by = $2 where square_item_id = $1',
        [product.square_item_id, created.id],
      );
    } catch (error) {
      await this.square.deleteItem(created.id as string).catch(() => undefined); // do not leave an unnoticed copy
      throw error;
    }
    return created.id as string;
  }

  /** Step 2: photos and starting stock. Photos already in Square (from an earlier attempt) are not added twice. */
  private async addPhotosAndStock(squareId: string, product: LocalProduct, photoUrls: string[]) {
    const { item } = await this.square.getItem(squareId).catch(fromSquare);
    if (!item || item.type !== 'ITEM')
      throw new AppError('The new Square item could not be read back.', 502);
    const alreadyThere = (item.itemData?.imageIds ?? []).length;
    const toAdd = photoUrls.slice(alreadyThere);
    if (toAdd.length) {
      const buffers = await Promise.all(toAdd.map((url) => this.download(url)));
      const saved = await this.square.attachPhotos(squareId, product.name, buffers);
      if (saved < toAdd.length)
        throw new AppError(`Square accepted only ${saved} of ${toAdd.length} photos.`, 502);
    }
    const variationId = item.itemData?.variations?.[0]?.id;
    if (variationId && product.stock != null) {
      await this.square.setInitialInventoryCount(variationId, product.stock).catch(fromSquare);
    }
  }

  private async download(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) throw new AppError('One of the photos could not be read from our storage.', 502);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
      throw new AppError('One of the photos has an unexpected size.', 502);
    return bytes;
  }

  /**
   * Step 3: checks the Square copy as our database now sees it (after the sync) against the product we are
   * about to retire. Nothing has been changed or deleted here yet, so a mismatch simply cancels the move.
   */
  private async verifyCopy(product: LocalProduct, squareId: string, photoCount: number) {
    const copy = await this.db.one<{
      name: string;
      is_active: boolean;
      is_visible: boolean;
      price_cents: number | null;
      stock: number | null;
      photos: number;
    }>(
      `select p.name, p.is_active, p.is_visible, v.price_cents, i.quantity as stock,
              (select count(*)::int from public.product_images pi where pi.square_item_id = p.square_item_id) as photos
         from public.catalog_products p
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
        where p.square_item_id = $1 and p.source = 'square'`,
      [squareId],
    );
    const problems: string[] = [];
    if (!copy) problems.push('it did not arrive from Square');
    else {
      if (!copy.is_active) problems.push('it is not active in Square');
      if (copy.name.trim() !== product.name.trim()) problems.push('the name differs');
      if (Number(copy.price_cents) !== Number(product.price_cents))
        problems.push('the price differs');
      if (product.stock != null && Number(copy.stock ?? NaN) !== Number(product.stock))
        problems.push('the stock differs');
      if (copy.photos < photoCount)
        problems.push(`only ${copy.photos} of ${photoCount} photos arrived`);
      const wantHidden = !product.is_visible || product.availability === 'hidden';
      if (wantHidden === copy.is_visible)
        problems.push(
          wantHidden ? 'it is visible but should be hidden' : 'it is hidden but should be visible',
        );
    }
    if (problems.length)
      throw new AppError(`The copy in Square did not match (${problems.join(', ')}).`, 502);
  }

  /**
   * A step failed: take the copy out of Square again so the product is exactly as it was, and say so.
   * If Square will not let go of the copy, keep the note on our row so the next try reuses it instead of
   * making a second one. Nothing is ever deleted from our side before the move has fully succeeded.
   */
  private async revert(product: LocalProduct, squareId: string, error: unknown): Promise<unknown> {
    let undone = false;
    try {
      await this.square.deleteItem(squareId);
      await this.db.transaction(async (tx) => {
        await this.db.exec(
          "delete from public.catalog_products where square_item_id = $1 and source = 'square'",
          [squareId],
          tx,
        );
        await this.db.exec(
          'update public.catalog_products set replaced_by = null where square_item_id = $1',
          [product.square_item_id],
          tx,
        );
      });
      undone = true;
    } catch {
      /* reported below */
    }
    if (!(error instanceof AppError)) return error;
    const outcome = undone
      ? 'The move was undone: the product is back exactly as it was.'
      : 'The copy in Square could not be removed automatically; the next try will reuse it. Nothing was deleted here.';
    return new AppError(`${error.message} ${outcome}`, error.status);
  }

  /** Step 4: what only we hold moves to the Square product, and the old row is retired. */
  private async carryOver(product: LocalProduct, squareId: string) {
    const oldId = product.square_item_id;
    const mirrored = await this.db.one<Pick<CatalogProductRow, 'default_variation_id'>>(
      "select default_variation_id from public.catalog_products where square_item_id = $1 and source = 'square'",
      [squareId],
    );
    if (!mirrored)
      throw new AppError('The new Square item has not arrived in our database yet.', 502);

    await this.db.transaction(async (tx) => {
      // Series, JAN code, featured, shop category, release dates ... (only if the Square item has none yet).
      await this.db.exec(
        `update public.product_metadata set square_item_id = $2
          where square_item_id = $1
            and not exists (select 1 from public.product_metadata where square_item_id = $2)`,
        [oldId, squareId],
        tx,
      );
      await this.db.exec(
        `insert into public.wishlist_items (user_id, square_item_id, created_at)
         select user_id, $2, created_at from public.wishlist_items where square_item_id = $1
         on conflict do nothing`,
        [oldId, squareId],
        tx,
      );
      await this.db.exec(
        'delete from public.wishlist_items where square_item_id = $1',
        [oldId],
        tx,
      );
      if (product.default_variation_id && mirrored.default_variation_id) {
        await this.db.exec(
          `update public.stock_alerts set square_variation_id = $2
            where square_variation_id = $1
              and not exists (select 1 from public.stock_alerts a
                               where a.square_variation_id = $2 and a.email = public.stock_alerts.email)`,
          [product.default_variation_id, mirrored.default_variation_id],
          tx,
        );
      }
      // The product keeps the date it was first added here, not the day it was moved.
      await this.db.exec(
        `update public.catalog_products set square_created_at = (select created_at from public.catalog_products where square_item_id = $1)
          where square_item_id = $2`,
        [oldId, squareId],
        tx,
      );
      await this.db.exec(
        `update public.catalog_variations set is_sellable = false where square_item_id = $1`,
        [oldId],
        tx,
      );
      await this.db.exec(
        `update public.catalog_products set is_active = false, is_visible = false, replaced_by = $2
          where square_item_id = $1`,
        [oldId, squareId],
        tx,
      );
    });
  }
}
