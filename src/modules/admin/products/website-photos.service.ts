import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';
import { SquarePhotosService } from './square-photos.service.js';

/**
 * Which of a Square product's photos the website leaves out. They stay on the product in Square (the till, and eBay later); the website
 * shows the others, in Square's order (the storefront_products view skips these). Known by Square photo id. One photo always stays on the
 * website, so a product never loses its picture there by accident.
 */
@Injectable()
export class WebsitePhotosService {
  constructor(
    private readonly db: Db,
    private readonly photos: SquarePhotosService,
    private readonly log: AdminLog,
  ) {}

  /** The Square ids of the product's photos that are not on the website. */
  async hidden(itemId: string): Promise<string[]> {
    return (
      await this.db.many<{ image_id: string }>(
        'select image_id from public.website_hidden_photos where square_item_id = $1 order by created_at',
        [itemId],
      )
    ).map((r) => r.image_id);
  }

  /** Records which photos are not on the website (done when a draft is added, before anyone can see it). */
  async hide(itemId: string, imageIds: string[]) {
    for (const id of new Set(imageIds))
      await this.db.exec(
        'insert into public.website_hidden_photos (square_item_id, image_id) values ($1, $2) on conflict do nothing',
        [itemId, id],
      );
  }

  /** Puts one of the product's Square photos on the website, or takes it off (it stays in Square). Returns the ids now off the website. */
  async set(adminId: string, itemId: string, imageId: string, onWebsite: boolean) {
    const { shown } = await this.photos.list(itemId);
    if (!shown.some((p) => p.id === imageId))
      throw new AppError('That photo is not one of this product’s photos in Square.', 404);
    const hiddenNow = new Set(await this.hidden(itemId));
    if (onWebsite)
      await this.db.exec(
        'delete from public.website_hidden_photos where square_item_id = $1 and image_id = $2',
        [itemId, imageId],
      );
    else {
      const left = shown.filter((p) => p.id !== imageId && !hiddenNow.has(p.id));
      if (!left.length)
        throw new AppError(
          'Keep at least one photo on the website: it is the product’s picture there.',
        );
      await this.hide(itemId, [imageId]);
    }
    await this.log.write(adminId, 'product.website_photo', itemId, { imageId, onWebsite });
    return this.hidden(itemId);
  }
}
