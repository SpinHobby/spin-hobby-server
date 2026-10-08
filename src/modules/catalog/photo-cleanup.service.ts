import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import { StorageService } from '../../integrations/storage/storage.service.js';

/**
 * Cleans up after a hand-entered product has been moved into Square: deletes its photo files from our
 * storage and then removes the old row, so the product exists once (the Square copy). It runs right after a
 * move and at the end of every Square sync, so a move that stopped half way is tidied up by itself.
 */
@Injectable()
export class PhotoCleanupService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /**
   * Removes every moved product's photos (files and rows) and then the product itself. A row only counts as
   * moved once it is inactive, which the move sets as its last step, so a move still in progress is left alone.
   * Safe to repeat. If the storage call fails nothing is deleted, so the next run tries again.
   * Returns how many photos were removed.
   */
  async purgeReplacedProducts(): Promise<number> {
    const moved = await this.db.many<{ square_item_id: string }>(
      'select square_item_id from public.catalog_products where replaced_by is not null and not is_active',
    );
    if (!moved.length) return 0;
    const ids = moved.map((m) => m.square_item_id);
    const photos = await this.db.many<{ image_url: string }>(
      'select image_url from public.product_images where square_item_id = any($1::text[])',
      [ids],
    );
    if (photos.length) await this.storage.deleteImages(photos.map((p) => p.image_url));
    // Photos, variations and any leftover metadata go with the row (ON DELETE CASCADE).
    await this.db.exec(
      'delete from public.catalog_products where square_item_id = any($1::text[]) and replaced_by is not null and not is_active',
      [ids],
    );
    return photos.length;
  }
}
