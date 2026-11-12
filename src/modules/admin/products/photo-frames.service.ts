import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';

/** Where a photo sits in its square: the point kept in view (x, y: 0-100 % across and down) and how far it is zoomed in (1-4). */
export interface PhotoFrame {
  x: number;
  y: number;
  zoom: number;
}
const CENTRED: PhotoFrame = { x: 50, y: 50, zoom: 1 };
const isCentred = (f: PhotoFrame) =>
  f.x === CENTRED.x && f.y === CENTRED.y && f.zoom === CENTRED.zoom;

/**
 * Product photos fill their square on the shop (cropped, never shrunk with a margin). An admin can move a photo and zoom in so the right
 * part shows; this keeps that per product and photo address. A photo left in the middle at no zoom has no row.
 */
@Injectable()
export class PhotoFramesService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** The product's moved or zoomed photos, by address. */
  async list(itemId: string): Promise<Record<string, PhotoFrame>> {
    const rows = await this.db.many<{ image_url: string; x: number; y: number; zoom: number }>(
      'select image_url, x, y, zoom from public.photo_frames where square_item_id = $1',
      [itemId],
    );
    return Object.fromEntries(rows.map((r) => [r.image_url, { x: r.x, y: r.y, zoom: r.zoom }]));
  }

  /** Saves where one of the product's photos sits; back in the middle at no zoom forgets it. Returns all of the product's frames. */
  async set(adminId: string, itemId: string, url: string, frame: PhotoFrame) {
    const known = await this.db.one(
      `select 1 from public.product_images where square_item_id = $1 and image_url = $2
       union all
       select 1 from public.photo_frames where square_item_id = $1 and image_url = $2
       limit 1`,
      [itemId, url],
    );
    if (!known) throw new AppError('That photo does not belong to this product.', 404);
    if (isCentred(frame))
      await this.db.exec(
        'delete from public.photo_frames where square_item_id = $1 and image_url = $2',
        [itemId, url],
      );
    else
      await this.db.exec(
        `insert into public.photo_frames (square_item_id, image_url, x, y, zoom) values ($1, $2, $3, $4, $5)
         on conflict (square_item_id, image_url) do update set x = excluded.x, y = excluded.y, zoom = excluded.zoom`,
        [itemId, url, frame.x, frame.y, frame.zoom],
      );
    await this.log.write(adminId, 'product.photo_framed', itemId, { ...frame });
    return this.list(itemId);
  }
}
