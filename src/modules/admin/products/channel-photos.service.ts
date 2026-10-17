import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminLog } from '../admin-log.service.js';
import { SquarePhotosService } from './square-photos.service.js';

export type Channel = 'ebay';
const MAX_PHOTOS = 12;

/**
 * The photos a product uses on a sales channel other than Square (today eBay, which is not connected yet). A person picks them; they are kept in
 * order, as addresses: a Square photo of the product, or a copy in our own storage (a photo chosen for eBay only). When eBay is connected, these are
 * what a listing is made with.
 */
@Injectable()
export class ChannelPhotosService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly photos: SquarePhotosService,
    private readonly log: AdminLog,
  ) {}

  async list(itemId: string, channel: Channel = 'ebay'): Promise<string[]> {
    return (
      await this.db.many<{ image_url: string }>(
        'select image_url from public.channel_photos where square_item_id = $1 and channel = $2 order by position, created_at',
        [itemId, channel],
      )
    ).map((r) => r.image_url);
  }

  /** Sets the channel's photos, in order. Each must be one of the product's photos in Square or one already kept for it; ours that are dropped are deleted. */
  async set(
    adminId: string,
    itemId: string,
    urls: string[],
    channel: Channel = 'ebay',
  ): Promise<string[]> {
    if (urls.length > MAX_PHOTOS) throw new AppError(`Pick at most ${MAX_PHOTOS} photos.`);
    const current = await this.list(itemId, channel);
    const { shown, hidden } = await this.photos.list(itemId);
    const allowed = new Set([...current, ...shown.map((p) => p.url), ...hidden.map((p) => p.url)]);
    if (urls.some((u) => !allowed.has(u)))
      throw new AppError('One of those photos does not belong to this product.');
    const wanted = [...new Set(urls)];
    await this.db.transaction(async (tx) => {
      await this.db.exec(
        'delete from public.channel_photos where square_item_id = $1 and channel = $2',
        [itemId, channel],
        tx,
      );
      for (const [i, url] of wanted.entries())
        await this.db.exec(
          'insert into public.channel_photos (square_item_id, channel, image_url, position) values ($1, $2, $3, $4)',
          [itemId, channel, url, i],
          tx,
        );
    });
    // our own copies no longer picked (Square's photos are not ours to delete)
    await this.storage
      .deleteImages(current.filter((u) => !wanted.includes(u)))
      .catch(() => undefined);
    await this.log.write(adminId, 'product.channel_photos_changed', itemId, {
      channel,
      photos: wanted.length,
    });
    return wanted;
  }
}
