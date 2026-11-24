import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AppError, notFound } from '../../../common/errors.js';
import { photoEvents } from '../../../common/photo-events.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminLog } from '../admin-log.service.js';
import { ownBackground, type BackgroundMode, type BackgroundRule } from './product-background.js';

/** Box art smaller than this would look soft behind a product photo. */
const MIN_SIDE = 400;
/** The public list is asked for by every visitor: read from the database at most this often. */
const PUBLIC_TTL_MS = 30_000;

interface FactsRow {
  square_item_id: string;
  mode: BackgroundMode | null;
  background_id: string | null;
  library_url: string | null;
  box_art_url: string | null;
}

const FACTS = `
  select coalesce(pb.square_item_id, a.square_item_id) as square_item_id, pb.mode, pb.background_id,
         b.image_url as library_url, a.image_url as box_art_url
    from public.product_backgrounds pb
    full join public.product_box_art a on a.square_item_id = pb.square_item_id
    left join public.photo_backgrounds b on b.id = pb.background_id`;

/**
 * Each product's background. Every transparent product photo used to show on the one shop background; a product can now have its own: plain
 * white, a background of the library, or its box art (the artwork of its own box, softened: made in the admin's browser and only stored
 * here). Products with no choice follow the shop's rule: the shop background, or box art where a product has one. The website draws the
 * transparent photo on whatever the product has now, so a choice can be changed at any time, for one product or for all, and nothing is
 * re-made.
 */
@Injectable()
export class ProductBackgroundsService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly log: AdminLog,
  ) {}

  private publicList: { at: number; items: Record<string, string | null> } | null = null;

  /** Something a product's background depends on changed elsewhere (a library background was deleted): read the list again. */
  forget() {
    this.publicList = null;
  }

  private changed() {
    this.publicList = null;
    // places that keep their own copy of a photo on its background (the eBay sync) make it again
    photoEvents.backgroundChanged();
  }

  async rule(): Promise<BackgroundRule> {
    const row = await this.db.one<{ product_background_rule: BackgroundRule }>(
      'select product_background_rule from public.store_settings limit 1',
    );
    return row?.product_background_rule ?? 'shop';
  }

  /** The products that show on a background of their own, for the website: product id to the background's address (null: plain white). */
  async publicBackgrounds(): Promise<Record<string, string | null>> {
    if (this.publicList && Date.now() - this.publicList.at < PUBLIC_TTL_MS)
      return this.publicList.items;
    const [rule, rows] = await Promise.all([this.rule(), this.db.many<FactsRow>(FACTS)]);
    const items: Record<string, string | null> = {};
    for (const r of rows) {
      const own = ownBackground(
        { mode: r.mode, libraryUrl: r.library_url, boxArtUrl: r.box_art_url },
        rule,
      );
      if (own) items[r.square_item_id] = own.url;
    }
    this.publicList = { at: Date.now(), items };
    return items;
  }

  /** One product's own background (undefined: the shop background), for places that make a photo on its background themselves. */
  async ownBackgroundOf(itemId: string): Promise<{ url: string | null } | undefined> {
    const items = await this.publicBackgrounds();
    return itemId in items ? { url: items[itemId]! } : undefined;
  }

  /** What the admin sees for one product: its choice, its box art, and what its photos show on now. */
  async forProduct(itemId: string) {
    const [rule, row] = await Promise.all([
      this.rule(),
      this.db.one<FactsRow>(`${FACTS} where coalesce(pb.square_item_id, a.square_item_id) = $1`, [
        itemId,
      ]),
    ]);
    const own = ownBackground(
      {
        mode: row?.mode ?? null,
        libraryUrl: row?.library_url ?? null,
        boxArtUrl: row?.box_art_url ?? null,
      },
      rule,
    );
    return {
      mode: row?.mode ?? null,
      backgroundId: row?.mode === 'library' ? row.background_id : null,
      boxArtUrl: row?.box_art_url ?? null,
      rule,
      // what shows now: 'shop' (the shop background), or the product's own (null: white)
      shows: own ? { own: true, url: own.url } : { own: false, url: null },
    };
  }

  private async library(backgroundId: string | null | undefined): Promise<string> {
    const row = backgroundId
      ? await this.db.one<{ id: string }>('select id from public.photo_backgrounds where id = $1', [
          backgroundId,
        ])
      : null;
    if (!row) throw new AppError('Choose a background from the library.', 400);
    return row.id;
  }

  /** Sets one product's own choice; `null` takes it away (the shop's rule decides again). */
  async set(
    adminId: string,
    itemId: string,
    mode: BackgroundMode | null,
    backgroundId?: string | null,
  ) {
    if (mode === null) {
      await this.db.exec('delete from public.product_backgrounds where square_item_id = $1', [
        itemId,
      ]);
    } else {
      const library = mode === 'library' ? await this.library(backgroundId) : null;
      if (mode === 'box_art') {
        const art = await this.db.one(
          'select 1 from public.product_box_art where square_item_id = $1',
          [itemId],
        );
        if (!art)
          throw new AppError(
            'This product has no box art yet. Make it from one of its photos first.',
            409,
          );
      }
      await this.db.exec(
        `insert into public.product_backgrounds (square_item_id, mode, background_id, updated_by) values ($1, $2, $3, $4)
           on conflict (square_item_id) do update set mode = excluded.mode, background_id = excluded.background_id,
             updated_by = excluded.updated_by, updated_at = now()`,
        [itemId, mode, library, adminId],
      );
    }
    this.changed();
    await this.log.write(adminId, 'product.background_set', itemId, { mode: mode ?? 'rule' });
    return this.forProduct(itemId);
  }

  /** Keeps a product's box art (made in the admin's browser, or uploaded): the picture is only checked and stored. */
  async saveBoxArt(adminId: string, itemId: string, bytes: Buffer, contentType: string) {
    if (!IMAGE_TYPES[contentType]) throw new AppError('Upload a WebP, JPEG or PNG image.');
    const known = await this.db.one(
      'select 1 from public.catalog_products where square_item_id = $1',
      [itemId],
    );
    if (!known) throw notFound('Product');
    const meta = await sharp(bytes)
      .metadata()
      .catch(() => null);
    if (!meta?.width || !meta.height) throw new AppError('That file is not a picture we can read.');
    if (Math.min(meta.width, meta.height) < MIN_SIDE)
      throw new AppError(
        `The box art is too small (${meta.width}×${meta.height}). Use one at least ${MIN_SIDE} pixels on each side.`,
      );
    const stored = await this.storage.uploadImage(bytes, contentType, 'backgrounds');
    const old = await this.db.one<{ image_url: string }>(
      'select image_url from public.product_box_art where square_item_id = $1',
      [itemId],
    );
    await this.db.exec(
      `insert into public.product_box_art (square_item_id, image_url, created_by) values ($1, $2, $3)
         on conflict (square_item_id) do update set image_url = excluded.image_url, created_by = excluded.created_by, created_at = now()`,
      [itemId, stored.url, adminId],
    );
    if (old) await this.storage.deleteImages([old.image_url]).catch(() => undefined);
    this.changed();
    await this.log.write(adminId, 'product.box_art_saved', itemId, {});
    return this.forProduct(itemId);
  }

  /** Deletes a product's box art. A product that chose it shows on the shop background again. */
  async removeBoxArt(adminId: string, itemId: string) {
    const row = await this.db.one<{ image_url: string }>(
      'delete from public.product_box_art where square_item_id = $1 returning image_url',
      [itemId],
    );
    if (!row) throw notFound('Box art');
    await this.storage.deleteImages([row.image_url]).catch(() => undefined);
    this.changed();
    await this.log.write(adminId, 'product.box_art_deleted', itemId, {});
    return this.forProduct(itemId);
  }

  // ---- the whole shop ------------------------------------------------------------------------------------------------------------------

  /** The rule, and how many products have what, for the Backgrounds screen. */
  async overview() {
    const [rule, row] = await Promise.all([
      this.rule(),
      this.db.one<{
        transparent: number;
        box_art: number;
        own: number;
        white: number;
        library: number;
        chose_box_art: number;
      }>(
        `select
           (select count(distinct square_item_id)::int from public.product_cutouts where transparent) as transparent,
           (select count(*)::int from public.product_box_art) as box_art,
           (select count(*)::int from public.product_backgrounds) as own,
           (select count(*)::int from public.product_backgrounds where mode = 'white') as white,
           (select count(*)::int from public.product_backgrounds where mode = 'library') as library,
           (select count(*)::int from public.product_backgrounds where mode = 'box_art') as chose_box_art`,
      ),
    ]);
    return {
      rule,
      products: {
        // products with a transparent photo: the ones a background shows behind
        transparent: row?.transparent ?? 0,
        withBoxArt: row?.box_art ?? 0,
        withOwnChoice: row?.own ?? 0,
        white: row?.white ?? 0,
        library: row?.library ?? 0,
        boxArt: row?.chose_box_art ?? 0,
      },
    };
  }

  async setRule(adminId: string, rule: BackgroundRule) {
    await this.db.exec('update public.store_settings set product_background_rule = $1', [rule]);
    this.changed();
    await this.log.write(adminId, 'photos.background_rule', rule, {});
    return this.overview();
  }

  /**
   * Gives many products the same choice at once: the ones named, or every product of the shop. `null` takes their own choices away (the rule
   * decides again). Box art is given only to products that have it ("where there is one"); the others keep what they had and are counted.
   */
  async setMany(
    adminId: string,
    mode: BackgroundMode | null,
    backgroundId: string | null | undefined,
    itemIds: string[] | null,
  ) {
    const only = itemIds?.length ? itemIds : null;
    let changed: number;
    let skipped = 0;
    if (mode === null) {
      const rows = await this.db.many(
        'delete from public.product_backgrounds where $1::text[] is null or square_item_id = any($1::text[]) returning square_item_id',
        [only],
      );
      changed = rows.length;
    } else {
      const library = mode === 'library' ? await this.library(backgroundId) : null;
      const rows = await this.db.many<{ square_item_id: string }>(
        `insert into public.product_backgrounds (square_item_id, mode, background_id, updated_by)
           select p.square_item_id, $2::text, $3::uuid, $4::uuid from public.catalog_products p
            where ($1::text[] is null or p.square_item_id = any($1::text[]))
              and ($2::text <> 'box_art' or exists (select 1 from public.product_box_art a where a.square_item_id = p.square_item_id))
           on conflict (square_item_id) do update set mode = excluded.mode, background_id = excluded.background_id,
             updated_by = excluded.updated_by, updated_at = now()
         returning square_item_id`,
        [only, mode, library, adminId],
      );
      changed = rows.length;
      if (mode === 'box_art') {
        const all = await this.db.one<{ n: number }>(
          'select count(*)::int as n from public.catalog_products p where $1::text[] is null or p.square_item_id = any($1::text[])',
          [only],
        );
        skipped = Math.max(0, (all?.n ?? 0) - changed);
      }
    }
    this.changed();
    await this.log.write(adminId, 'photos.background_set_many', mode ?? 'rule', {
      changed,
      skipped,
      all: !only,
    });
    return { changed, skipped, ...(await this.overview()) };
  }

  /**
   * Products that could have box art and have none: each has a transparent photo (so a background shows) and another photo that is not a
   * cut-out (the shop's own photo of the box), which the admin's browser turns into box art.
   */
  async boxArtCandidates(limit = 500) {
    const rows = await this.db.many<{ square_item_id: string; name: string; photo_url: string }>(
      `select p.square_item_id, p.name, box.image_url as photo_url
         from public.catalog_products p
         join lateral (
           select pi.image_url from public.product_images pi
             left join public.product_cutouts c on c.image_id = coalesce(pi.square_image_id, pi.image_url)
            where pi.square_item_id = p.square_item_id and c.id is null
            order by pi.sort_order limit 1
         ) box on true
        where exists (select 1 from public.product_cutouts c where c.square_item_id = p.square_item_id and c.transparent)
          and not exists (select 1 from public.product_box_art a where a.square_item_id = p.square_item_id)
        order by p.name limit $1`,
      [limit],
    );
    return rows.map((r) => ({ itemId: r.square_item_id, name: r.name, photoUrl: r.photo_url }));
  }
}
