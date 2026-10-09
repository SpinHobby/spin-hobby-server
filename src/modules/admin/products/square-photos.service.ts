import { Injectable } from '@nestjs/common';
import { AppError, errorText, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { SquareCatalogClient } from '../../../integrations/square/square-catalog.client.js';
import { processEditedPhoto } from '../../cashier/image-processing.js';
import { SquareSyncService } from '../../square-sync/square-sync.service.js';
import { AdminLog } from '../admin-log.service.js';

const MAX_SHOWN = 12;

export interface PhotoInfo {
  id: string;
  url: string;
}

function fromSquare(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new AppError(`Square said: ${errorText(error)}`, 502);
}

/**
 * The photos of a Square product, kept in Square (none are stored here). A photo is shown when it is in the item's
 * photo list and hidden when it is taken out; editing makes a NEW photo and hides the original; a photo is only ever
 * deleted when the admin asks for exactly that.
 */
@Injectable()
export class SquarePhotosService {
  private readonly busy = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly square: SquareCatalogClient,
    private readonly sync: SquareSyncService,
    private readonly log: AdminLog,
  ) {}

  private async assertSquareItem(itemId: string) {
    const row = await this.db.one<{ source: string }>(
      'select source from public.catalog_products where square_item_id = $1',
      [itemId],
    );
    if (!row) throw notFound('Product');
    if (row.source !== 'square')
      throw new AppError(
        'Photos are edited in the product drawer for products kept in our database.',
      );
  }

  private async hiddenIds(itemId: string) {
    return (
      await this.db.many<{ image_id: string }>(
        'select image_id from public.hidden_photos where square_item_id = $1 order by created_at',
        [itemId],
      )
    ).map((r) => r.image_id);
  }

  /** Runs one change at a time per product, so two quick clicks cannot overwrite each other. */
  private async exclusive<T>(itemId: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(itemId))
      throw new AppError('Photos for this product are being updated. Try again in a moment.', 409);
    this.busy.add(itemId);
    try {
      return await work();
    } finally {
      this.busy.delete(itemId);
    }
  }

  async list(itemId: string) {
    await this.assertSquareItem(itemId);
    const shownIds = await this.square.readImageIds(itemId).catch(fromSquare);
    const hiddenIds = (await this.hiddenIds(itemId)).filter((id) => !shownIds.includes(id));
    const urls = await this.square.imageUrls([...shownIds, ...hiddenIds]).catch(fromSquare);
    const pick = (ids: string[]): PhotoInfo[] =>
      ids.filter((id) => urls[id]).map((id) => ({ id, url: urls[id] }));
    // A hidden photo Square no longer has is forgotten.
    const gone = hiddenIds.filter((id) => !urls[id]);
    if (gone.length)
      await this.db.exec('delete from public.hidden_photos where image_id = any($1::text[])', [
        gone,
      ]);
    return { shown: pick(shownIds), hidden: pick(hiddenIds) };
  }

  /** Writes the new photo list to Square, records what became hidden, and refreshes our copy of the product. */
  private async apply(
    adminId: string,
    itemId: string,
    shown: string[],
    detached: string[],
    revived: string[],
  ) {
    if (shown.length > MAX_SHOWN)
      throw new AppError(`A product can show at most ${MAX_SHOWN} photos. Hide one first.`);
    await this.square.setItemImageIds(itemId, shown).catch(fromSquare);
    await this.db.transaction(async (tx) => {
      if (revived.length)
        await this.db.exec(
          'delete from public.hidden_photos where image_id = any($1::text[])',
          [revived],
          tx,
        );
      for (const id of detached)
        await this.db.exec(
          'insert into public.hidden_photos (image_id, square_item_id) values ($1, $2) on conflict (image_id) do nothing',
          [id, itemId],
          tx,
        );
    });
    await this.sync.syncItems([itemId]).catch(() => undefined); // the 15-minute sync catches up if this fails
    await this.log.write(adminId, 'product.photos_changed', itemId, { shown, hidden: detached });
  }

  /** Shows these photos in this order; the other shown photos are hidden (kept), and listed hidden ones come back. */
  async setOrder(adminId: string, itemId: string, ids: string[]) {
    await this.assertSquareItem(itemId);
    return this.exclusive(itemId, async () => {
      const shownNow = await this.square.readImageIds(itemId).catch(fromSquare);
      const hiddenNow = await this.hiddenIds(itemId);
      const known = new Set([...shownNow, ...hiddenNow]);
      if (ids.some((id) => !known.has(id)))
        throw new AppError('One of those photos does not belong to this product.');
      await this.apply(
        adminId,
        itemId,
        ids,
        shownNow.filter((id) => !ids.includes(id)),
        ids.filter((id) => hiddenNow.includes(id)),
      );
      return this.list(itemId);
    });
  }

  /** Adds a new photo. With `replaces`, it takes that photo's place and the original is hidden, never deleted. */
  async add(adminId: string, itemId: string, data: Buffer, replaces: string | null) {
    await this.assertSquareItem(itemId);
    return this.exclusive(itemId, async () => {
      const shownNow = await this.square.readImageIds(itemId).catch(fromSquare);
      if (replaces && !shownNow.includes(replaces))
        throw new AppError('The photo being edited is no longer on this product.');
      if (!replaces && shownNow.length >= MAX_SHOWN)
        throw new AppError(`A product can show at most ${MAX_SHOWN} photos. Hide one first.`);
      const name =
        (
          await this.db.one<{ name: string }>(
            'select name from public.catalog_products where square_item_id = $1',
            [itemId],
          )
        )?.name ?? 'Product';
      const created = await this.square
        .createImage(itemId, name, await processEditedPhoto(data))
        .catch(fromSquare);
      const withoutNew = shownNow.filter((id) => id !== created);
      const shown = replaces
        ? withoutNew.map((id) => (id === replaces ? created : id))
        : [...withoutNew, created];
      await this.apply(adminId, itemId, shown, replaces ? [replaces] : [], []);
      return { created, ...(await this.list(itemId)) };
    });
  }

  /** Deletes a photo from Square for good. Only when the admin asks; the photo is taken off the product first. */
  async remove(adminId: string, itemId: string, imageId: string) {
    await this.assertSquareItem(itemId);
    return this.exclusive(itemId, async () => {
      const shownNow = await this.square.readImageIds(itemId).catch(fromSquare);
      const hiddenNow = await this.hiddenIds(itemId);
      if (!shownNow.includes(imageId) && !hiddenNow.includes(imageId))
        throw new AppError('That photo does not belong to this product.', 404);
      if (shownNow.includes(imageId))
        await this.square
          .setItemImageIds(
            itemId,
            shownNow.filter((id) => id !== imageId),
          )
          .catch(fromSquare);
      await this.square.deleteImages([imageId]).catch(fromSquare);
      await this.db.exec('delete from public.hidden_photos where image_id = $1', [imageId]);
      await this.sync.syncItems([itemId]).catch(() => undefined);
      await this.log.write(adminId, 'product.photo_deleted', itemId, { imageId });
      return this.list(itemId);
    });
  }
}
