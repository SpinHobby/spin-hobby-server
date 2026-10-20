import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AppError, notFound } from '../../../common/errors.js';
import { photoEvents } from '../../../common/photo-events.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminLog } from '../admin-log.service.js';
import { composeOnBackground, transparentPhoto } from './compose-photo.js';
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
  transparent: boolean;
}

/** Photos on a background, made for places that cannot show transparency (eBay, link previews), kept for a while. */
const COMPOSED_CACHE = 80;

const present = (r: BackgroundRow) => ({
  id: r.id,
  name: r.name,
  imageUrl: r.image_url,
  isDefault: r.is_default,
  createdAt: r.created_at,
});

/**
 * The shop's own backgrounds for product photos, and the cut-outs behind its photos. A background is uploaded in the admin and kept in our image
 * storage (never Square's). The library's default is the shop background: a photo made from a Gleamshelf cut-out is saved to Square transparent (the
 * product alone, as a PNG), and the website shows every such photo on the shop background (white when there is none). Changing the shop background
 * (a seasonal one) changes every product at once; nothing is re-made. Places that cannot show transparency (eBay, link previews) get the cut-out on
 * the shop background, made here when they fetch it. Photos made before kept a background baked in; they can be switched to transparent.
 */
@Injectable()
export class PhotoBackgroundsService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly photos: SquarePhotosService,
    private readonly log: AdminLog,
  ) {}

  private readonly composed = new Map<string, Buffer>();

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

  /** The shop background: every transparent product photo shows on it. Null is plain white. */
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
    this.composed.clear();
    photoEvents.backgroundChanged();
    await this.log.write(adminId, 'photos.background_default', id ?? 'white', {});
    return this.list();
  }

  /** Deletes a background. The shop background deleted means plain white; older photos with it baked in stay as they are (they are in Square). */
  async remove(adminId: string, id: string) {
    const row = await this.db.one<BackgroundRow>(
      'delete from public.photo_backgrounds where id = $1 returning *',
      [id],
    );
    if (!row) throw notFound('Background');
    await this.storage.deleteImages([row.image_url]).catch(() => undefined);
    if (row.is_default) {
      this.composed.clear();
      photoEvents.backgroundChanged();
    }
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

  /** The shop background (null: plain white). */
  shopBackground(): Promise<BackgroundRow | null> {
    return this.resolve(undefined);
  }

  /** What the shop keeps for a cut-out: the product on a transparent square, as a PNG (see `transparentPhoto`). */
  async transparent(cutoutUrl: string): Promise<Buffer> {
    return transparentPhoto(await downloadPhoto(cutoutUrl));
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

  /**
   * Remembers that this Square photo was made from this cut-out: transparent (it shows on the shop background), or not (the photo computer's white
   * square), so it can be switched to transparent later.
   */
  async remember(itemId: string, imageId: string, cutoutUrl: string, transparent: boolean) {
    await this.db.exec(
      `insert into public.product_cutouts (square_item_id, image_id, cutout_url, background_id, transparent) values ($1, $2, $3, null, $4)
         on conflict (image_id) do update set cutout_url = excluded.cutout_url, background_id = null, transparent = excluded.transparent`,
      [itemId, imageId, cutoutUrl, transparent],
    );
  }

  /** The product's photos that have a cut-out: transparent ones show on the shop background; the others have a background of their own. */
  async cutouts(itemId: string) {
    const rows = await this.db.many<CutoutRow>(
      'select * from public.product_cutouts where square_item_id = $1',
      [itemId],
    );
    return rows.map((r) => ({
      imageId: r.image_id,
      cutoutUrl: r.cutout_url,
      transparent: r.transparent,
    }));
  }

  /**
   * Makes one of a product's photos transparent (one made before, with a background baked in): the cut-out on a transparent square takes the old
   * photo's place in Square, and from then on it shows on the shop background. The old photo was made here from the same cut-out, so it is deleted.
   */
  async makeTransparent(adminId: string, itemId: string, imageId: string) {
    const row = await this.db.one<CutoutRow>(
      'select * from public.product_cutouts where square_item_id = $1 and image_id = $2',
      [itemId, imageId],
    );
    if (!row)
      throw new AppError(
        'This photo has no cut-out, so it cannot be made transparent. Only photos made by the photo computer have one.',
        409,
      );
    if (row.transparent) return { created: imageId, ...(await this.photos.list(itemId)) };
    const { created } = await this.photos.add(
      adminId,
      itemId,
      await this.transparent(row.cutout_url),
      imageId,
    );
    await this.db.exec(
      'update public.product_cutouts set image_id = $2, background_id = null, transparent = true where id = $1',
      [row.id, created],
    );
    const lists = await this.photos
      .remove(adminId, itemId, imageId)
      .catch(() => this.photos.list(itemId));
    await this.log.write(adminId, 'product.photo_made_transparent', itemId, {
      imageId: created,
      replaced: imageId,
    });
    return { created, ...lists };
  }

  /** How many product photos are transparent, and how many older ones (made from a cut-out, with a background baked in) could be. */
  async counts() {
    const row = await this.db.one<{ transparent: number; older: number }>(
      'select count(*) filter (where transparent)::int as transparent, count(*) filter (where not transparent)::int as older from public.product_cutouts',
    );
    return { transparent: row?.transparent ?? 0, older: row?.older ?? 0 };
  }

  /** Makes every older cut-out photo transparent, one after the other; the ones Square refuses are counted and stay as they were. */
  async makeAllTransparent(adminId: string) {
    const rows = await this.db.many<CutoutRow>(
      'select * from public.product_cutouts where not transparent order by created_at',
    );
    let done = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        await this.makeTransparent(adminId, r.square_item_id, r.image_id);
        done++;
      } catch {
        failed++;
      }
    }
    return { done, failed, ...(await this.counts()) };
  }

  /**
   * A transparent product photo (by its address in Square, or an eBay copy that is a cut-out) on the shop background, as a JPEG: for eBay and link
   * previews, which cannot show transparency. Null when the address is no such photo. Made on demand and kept for a while.
   */
  async onShopBackground(wanted: { src?: string; imageId?: string }): Promise<Buffer | null> {
    const found = await this.db.one<{ cutout_url: string }>(
      `select c.cutout_url from public.product_cutouts c
        where c.transparent and (c.image_id = $2 or c.image_id = $1
          or c.image_id in (select pi.square_image_id from public.product_images pi where pi.image_url = $1))
       union all
       select image_url as cutout_url from public.channel_photos where image_url = $1 and cutout
       limit 1`,
      [wanted.src ?? null, wanted.imageId ?? null],
    );
    if (!found) return null;
    const background = await this.shopBackground();
    const key = `${found.cutout_url}|${background?.id ?? 'white'}`;
    const kept = this.composed.get(key);
    if (kept) return kept;
    const photo = await this.compose(found.cutout_url, background);
    if (this.composed.size >= COMPOSED_CACHE)
      this.composed.delete(this.composed.keys().next().value!);
    this.composed.set(key, photo);
    return photo;
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
