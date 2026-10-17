import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminLog } from '../admin-log.service.js';
import { composeOnBackground } from './compose-photo.js';
import { downloadPhoto } from './download-photo.js';
import { SquarePhotosService } from './square-photos.service.js';

const MAX_BACKGROUNDS = 40;
/** A background smaller than this would look soft behind a 1600-pixel photo. */
const MIN_SIDE = 600;

interface BackgroundRow {
  id: string;
  name: string;
  image_url: string;
  is_default: boolean;
  created_at: string;
}

interface CutoutRow {
  id: string;
  square_item_id: string;
  image_id: string;
  cutout_url: string;
  background_id: string | null;
}

const present = (r: BackgroundRow) => ({
  id: r.id,
  name: r.name,
  imageUrl: r.image_url,
  isDefault: r.is_default,
  createdAt: r.created_at,
});

/**
 * The shop's own backgrounds for product photos, and the cut-outs behind its photos. A background is uploaded in the admin and kept in our image
 * storage (never Square's). A photo made from a Gleamshelf cut-out is the cut-out placed on a background (or on white), made here and sent to Square
 * like any other photo; the cut-out is kept, so the background of a product's photo can be changed again at any time.
 */
@Injectable()
export class PhotoBackgroundsService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly photos: SquarePhotosService,
    private readonly log: AdminLog,
  ) {}

  // ---- the library ------------------------------------------------------------------------------------------------------------------

  async list() {
    const rows = await this.db.many<BackgroundRow>(
      'select * from public.photo_backgrounds order by is_default desc, created_at desc',
    );
    return rows.map(present);
  }

  async create(adminId: string, bytes: Buffer, contentType: string, rawName: string | null) {
    if (!IMAGE_TYPES[contentType]) throw new AppError('Upload a WebP, JPEG or PNG image.');
    const meta = await sharp(bytes)
      .metadata()
      .catch(() => null);
    if (!meta?.width || !meta.height) throw new AppError('That file is not a picture we can read.');
    if (Math.min(meta.width, meta.height) < MIN_SIDE)
      throw new AppError(
        `The background is too small (${meta.width}×${meta.height}). Use one at least ${MIN_SIDE} pixels on each side.`,
      );
    const count = await this.db.one<{ n: number }>(
      'select count(*)::int as n from public.photo_backgrounds',
    );
    if ((count?.n ?? 0) >= MAX_BACKGROUNDS)
      throw new AppError(`You can keep up to ${MAX_BACKGROUNDS} backgrounds. Delete one first.`);
    const name = (rawName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Background';
    const stored = await this.storage.uploadImage(bytes, contentType, 'backgrounds');
    const row = await this.db.one<BackgroundRow>(
      'insert into public.photo_backgrounds (name, image_url, created_by) values ($1, $2, $3) returning *',
      [name, stored.url, adminId],
    );
    await this.log.write(adminId, 'photos.background_added', row!.id, { name });
    return present(row!);
  }

  async rename(adminId: string, id: string, rawName: string) {
    const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw new AppError('Give the background a name.');
    const row = await this.db.one<BackgroundRow>(
      'update public.photo_backgrounds set name = $2 where id = $1 returning *',
      [id, name],
    );
    if (!row) throw notFound('Background');
    await this.log.write(adminId, 'photos.background_renamed', id, { name });
    return present(row);
  }

  /** The default is picked first when a photo is used; null means plain white is. */
  async setDefault(adminId: string, id: string | null) {
    await this.db.transaction(async (tx) => {
      await this.db.exec(
        'update public.photo_backgrounds set is_default = false where is_default',
        [],
        tx,
      );
      if (id) {
        const row = await this.db.one(
          'update public.photo_backgrounds set is_default = true where id = $1 returning id',
          [id],
          tx,
        );
        if (!row) throw notFound('Background');
      }
    });
    await this.log.write(adminId, 'photos.background_default', id ?? 'white', {});
    return this.list();
  }

  /** Deletes a background. Photos already made with it stay as they are (they are in Square); they just show "no longer in the library". */
  async remove(adminId: string, id: string) {
    const row = await this.db.one<BackgroundRow>(
      'delete from public.photo_backgrounds where id = $1 returning *',
      [id],
    );
    if (!row) throw notFound('Background');
    await this.storage.deleteImages([row.image_url]).catch(() => undefined);
    await this.log.write(adminId, 'photos.background_deleted', id, { name: row.name });
  }

  /**
   * The background a choice means: an id is that background, null is plain white, and leaving it out (undefined) is the shop's default (white
   * when there is none).
   */
  async resolve(choice: string | null | undefined): Promise<BackgroundRow | null> {
    if (choice === null) return null;
    if (choice === undefined)
      return this.db.one<BackgroundRow>(
        'select * from public.photo_backgrounds where is_default limit 1',
      );
    const row = await this.db.one<BackgroundRow>(
      'select * from public.photo_backgrounds where id = $1',
      [choice],
    );
    if (!row) throw new AppError('That background is no longer in the library.', 404);
    return row;
  }

  /** The finished photo: the stored cut-out on this background (white when none). */
  async compose(cutoutUrl: string, background: BackgroundRow | null): Promise<Buffer> {
    const [cutout, back] = await Promise.all([
      downloadPhoto(cutoutUrl),
      background ? downloadPhoto(background.image_url) : Promise.resolve(null),
    ]);
    return composeOnBackground(cutout, back);
  }

  // ---- the cut-outs behind a product's photos ----------------------------------------------------------------------------------------

  /** Remembers that this Square photo was made from this cut-out, so its background can be changed later. */
  async remember(itemId: string, imageId: string, cutoutUrl: string, backgroundId: string | null) {
    await this.db.exec(
      `insert into public.product_cutouts (square_item_id, image_id, cutout_url, background_id) values ($1, $2, $3, $4)
         on conflict (image_id) do update set cutout_url = excluded.cutout_url, background_id = excluded.background_id`,
      [itemId, imageId, cutoutUrl, backgroundId],
    );
  }

  /** The product's photos that have a cut-out, and the background each is on (null: white). */
  async cutouts(itemId: string) {
    const rows = await this.db.many<CutoutRow>(
      'select * from public.product_cutouts where square_item_id = $1',
      [itemId],
    );
    return rows.map((r) => ({
      imageId: r.image_id,
      cutoutUrl: r.cutout_url,
      backgroundId: r.background_id,
    }));
  }

  /**
   * Puts one of a product's photos on another background: the cut-out is placed on it here and the new photo takes the old one's place in Square.
   * The old photo was made here from the same cut-out, so it is deleted rather than kept hidden (it can always be made again).
   */
  async changeBackground(adminId: string, itemId: string, imageId: string, choice: string | null) {
    const row = await this.db.one<CutoutRow>(
      'select * from public.product_cutouts where square_item_id = $1 and image_id = $2',
      [itemId, imageId],
    );
    if (!row)
      throw new AppError(
        'This photo has no cut-out, so its background cannot be changed. Only photos made by the photo computer have one.',
        409,
      );
    const background = await this.resolve(choice);
    const photo = await this.compose(row.cutout_url, background);
    const { created } = await this.photos.add(adminId, itemId, photo, imageId);
    await this.db.exec(
      'update public.product_cutouts set image_id = $2, background_id = $3 where id = $1',
      [row.id, created, background?.id ?? null],
    );
    const lists = await this.photos
      .remove(adminId, itemId, imageId)
      .catch(() => this.photos.list(itemId));
    await this.log.write(adminId, 'product.photo_background_changed', itemId, {
      imageId: created,
      replaced: imageId,
      background: background?.name ?? 'white',
    });
    return { created, ...lists };
  }

  /** Forgets cut-outs whose photo Square no longer has, and deletes their files. */
  async forgetMissing(itemId: string, shownAndHidden: string[]) {
    const gone = await this.db.many<{ cutout_url: string }>(
      'delete from public.product_cutouts where square_item_id = $1 and not (image_id = any($2::text[])) returning cutout_url',
      [itemId, shownAndHidden],
    );
    if (gone.length)
      await this.storage.deleteImages(gone.map((g) => g.cutout_url)).catch(() => undefined);
  }
}
