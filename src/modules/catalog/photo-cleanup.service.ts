import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import { StorageService } from '../../integrations/storage/storage.service.js';

/**
 * Frees the storage used by photos nobody needs any more. It runs right after a product is moved into
 * Square and at the end of every Square sync, so a move that stopped half way is tidied up by itself.
 */
@Injectable()
export class PhotoCleanupService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /**
   * Deletes the photos of hand-entered products that now live in Square (their files and their rows).
   * Safe to repeat. If the storage call fails the rows are kept, so the next run tries again.
   * Returns how many photo rows were removed.
   */
  async purgeReplacedProducts(): Promise<number> {
    const photos = await this.db.many<{ square_item_id: string; image_url: string }>(
      `select pi.square_item_id, pi.image_url
         from public.product_images pi
         join public.catalog_products p on p.square_item_id = pi.square_item_id
        where p.replaced_by is not null`,
    );
    if (!photos.length) return 0;
    await this.storage.deleteImages(photos.map((p) => p.image_url));
    await this.db.exec('delete from public.product_images where square_item_id = any($1::text[])', [
      [...new Set(photos.map((p) => p.square_item_id))],
    ]);
    return photos.length;
  }
}
