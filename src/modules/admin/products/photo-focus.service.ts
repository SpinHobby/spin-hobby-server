import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';
import type { PhotoFrame } from './photo-frames.service.js';

interface FocusRow {
  square_item_id: string;
  image_url: string;
  x: number;
  y: number;
  zoom: number;
}
const focusOf = (r: FocusRow): PhotoFrame => ({ x: r.x, y: r.y, zoom: r.zoom });

/**
 * Where the face is in a product photo (photo_focus): the point a large, cropped picture of it is framed on, and how far in. Set by an
 * admin per product and photo address; a photo without one gets the shop's guess.
 */
@Injectable()
export class PhotoFocusService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** The product's photos that have a focus point, by address. */
  async list(itemId: string): Promise<Record<string, PhotoFrame>> {
    return (await this.forProducts([itemId]))[itemId] ?? {};
  }

  /** The focus points of several products at once: { product id: { photo address: point } }. */
  async forProducts(itemIds: string[]): Promise<Record<string, Record<string, PhotoFrame>>> {
    if (!itemIds.length) return {};
    const rows = await this.db.many<FocusRow>(
      'select square_item_id, image_url, x, y, zoom from public.photo_focus where square_item_id = any($1::text[])',
      [itemIds],
    );
    const out: Record<string, Record<string, PhotoFrame>> = {};
    for (const r of rows) (out[r.square_item_id] ??= {})[r.image_url] = focusOf(r);
    return out;
  }

  /** Saves the focus point of one of the product's photos. Returns all of the product's points. */
  async set(adminId: string, itemId: string, url: string, focus: PhotoFrame) {
    const known = await this.db.one(
      `select 1 from public.product_images where square_item_id = $1 and image_url = $2
       union all
       select 1 from public.photo_focus where square_item_id = $1 and image_url = $2
       limit 1`,
      [itemId, url],
    );
    if (!known) throw new AppError('That photo does not belong to this product.', 404);
    await this.db.exec(
      `insert into public.photo_focus (square_item_id, image_url, x, y, zoom) values ($1, $2, $3, $4, $5)
       on conflict (square_item_id, image_url) do update set x = excluded.x, y = excluded.y, zoom = excluded.zoom`,
      [itemId, url, focus.x, focus.y, focus.zoom],
    );
    await this.log.write(adminId, 'product.photo_focus_set', itemId, { ...focus });
    return this.list(itemId);
  }

  /** Forgets a photo's focus point: the shop goes back to its guess. Returns the product's remaining points. */
  async clear(adminId: string, itemId: string, url: string) {
    await this.db.exec(
      'delete from public.photo_focus where square_item_id = $1 and image_url = $2',
      [itemId, url],
    );
    await this.log.write(adminId, 'product.photo_focus_cleared', itemId);
    return this.list(itemId);
  }
}
