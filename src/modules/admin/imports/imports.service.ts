import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { port, publicApiUrl } from '../../../config/app.config.js';
import { PRODUCT_CATEGORIES } from '../../cashier/product-categories.js';
import {
  findCategory,
  labelCategories,
  type CategoryNode,
  type LabelledCategory,
} from '../categories/category-paths.js';
import { AdminLog } from '../admin-log.service.js';
import type { QuickAddDto } from '../products/dto/quick-add.dto.js';
import { cropToProduct } from '../products/compose-photo.js';
import { downloadPhoto } from '../products/download-photo.js';
import { PhotoBackgroundsService } from '../products/photo-backgrounds.service.js';
import { QuickAddService } from '../products/quick-add.service.js';
import { AdminMerchService } from '../merch/admin-merch.service.js';
import { squareAccessToken, squareLocationId } from '../../../config/square.config.js';
import { SquarePhotosService } from '../products/square-photos.service.js';
import { checkCutout } from './photo-jobs.service.js';
import { SeriesService } from '../series/series.service.js';
import { isOfficialUrl, parseDraft, type DraftInput, type OfficialPhoto } from './draft.js';
import { likelySameProducts, type ProductMatch, type ShopProduct } from './duplicates.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const TOKEN_PREFIX = 'gst_';
const PAIRING_MINUTES = 10;

export type ImportStatus = 'draft' | 'added' | 'rejected';
type ProductRect = { x: number; y: number; width: number; height: number };
export const IMPORT_STATUSES: ImportStatus[] = ['draft', 'added', 'rejected'];

interface ImportRow {
  id: string;
  source_key: string;
  status: ImportStatus;
  title: string;
  description: string | null;
  category: string | null;
  series: string | null;
  details: Record<string, unknown>;
  image_url: string | null;
  cutout_url: string | null;
  original_url: string | null;
  cropped_url: string | null;
  edited_photos: Record<string, string> | null;
  square_item_id: string | null;
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

/** The draft's photos: the studio photo, the cut-out on a background, the crop, the photo as taken, and the maker's photos (`official`, `official2`...). */
export type PhotoKey =
  'studio' | 'background' | 'original' | 'cropped' | 'official' | `official${number}`;
const isOfficialKey = (key: PhotoKey) => /^official\d*$/.test(key);
export interface PhotoChoice {
  key: PhotoKey;
  square: boolean;
  ebay: boolean;
}

/** The photos a draft offers, in the order they are shown. `background` is the cut-out, which is placed on a background chosen when it is used. */
function draftPhotos(r: ImportRow): { key: PhotoKey; url: string; edited: boolean }[] {
  const official = (r.details as { official?: OfficialPhoto | null }).official ?? null;
  const edits = editsOf(r);
  // a photo a person edited in the admin's photo editor is offered as edited (the cut-out is placed on a background instead, so it is not edited)
  return [
    r.image_url && { key: 'studio' as const, url: r.image_url },
    r.cutout_url && { key: 'background' as const, url: r.cutout_url },
    r.cropped_url && { key: 'cropped' as const, url: r.cropped_url },
    r.original_url && { key: 'original' as const, url: r.original_url },
    official && { key: 'official' as const, url: official.imageUrl },
    ...(official?.more ?? []).map((url, i) => ({ key: `official${i + 2}` as PhotoKey, url })),
  ]
    .filter((p): p is { key: PhotoKey; url: string } => !!p)
    .map((p) => ({ ...p, url: edits[p.key] ?? p.url, edited: !!edits[p.key] }));
}

/** The draft's edited photos, by photo. */
const editsOf = (r: Pick<ImportRow, 'edited_photos'>): Partial<Record<PhotoKey, string>> =>
  r.edited_photos ?? {};

/** The choices the older "which photo" setting meant: the shop's own (on its background when there is one), the official one, or both. */
function legacyChoices(photo: 'own' | 'official' | 'both', onBackground: boolean): PhotoChoice[] {
  const own: PhotoChoice = {
    key: onBackground ? 'background' : 'studio',
    square: true,
    ebay: false,
  };
  const off: PhotoChoice = { key: 'official', square: true, ebay: false };
  return photo === 'official' ? [off] : photo === 'both' ? [own, off] : [own];
}

/**
 * The draft's category as one of the shop's (its id), or, when the product fits none of them, the new category to suggest and the existing one to put
 * it under. A category name the shop does not have (a draft from before the shop's own tree was sent, or one it has since deleted) is suggested too.
 */
function categoryOf(r: ImportRow, categories: LabelledCategory[]) {
  const found = findCategory(categories, r.category);
  if (found) return { categoryId: found.id, suggestedCategory: null };
  const suggested =
    (r.details as Partial<DraftInput['details']>).suggestedCategory ??
    (r.category ? { name: r.category, under: null } : null);
  if (!suggested) return { categoryId: null, suggestedCategory: null };
  // a "new" category the shop already has is simply that category
  const existing = findCategory(categories, suggested.name);
  if (existing) return { categoryId: existing.id, suggestedCategory: null };
  const parent = findCategory(categories, suggested.under);
  return {
    categoryId: null,
    suggestedCategory: { name: suggested.name, parentId: parent?.id ?? null },
  };
}

const present = (r: ImportRow, categories: LabelledCategory[]) => ({
  id: r.id,
  status: r.status,
  title: r.title,
  description: r.description,
  category: r.category,
  ...categoryOf(r, categories),
  series: r.series,
  details: r.details,
  imageUrl: r.image_url,
  // the product alone on a transparent background, to put on one of the shop's backgrounds
  cutoutUrl: r.image_url ? r.cutout_url : null,
  // every photo a person can choose from for the product
  photos: r.image_url ? draftPhotos(r) : [],
  productId: r.square_item_id,
  rejectReason: r.reject_reason,
  createdAt: r.created_at,
  receivedAt: (r.details as { receivedAt?: string }).receivedAt ?? r.created_at,
  decidedAt: r.decided_at,
});

/**
 * Drafts from Gleamshelf, the photo studio app. An owner connects an app with a short code shown in the admin (the app gets a token that can
 * only send drafts and read the category and series lists); staff then review each draft, type the price and stock, and add it through the
 * normal quick add, or reject it. A draft is never a product by itself.
 */
@Injectable()
export class ImportsService {
  /** When wrong pairing codes were tried (by anyone): after too many in ten minutes nothing is accepted, so a code cannot be found by trying them all. */
  private pairingMisses: number[] = [];

  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly quickAdd: QuickAddService,
    private readonly series: SeriesService,
    private readonly log: AdminLog,
    private readonly backgrounds: PhotoBackgroundsService,
    private readonly photos: SquarePhotosService,
    private readonly merch: AdminMerchService,
  ) {}

  // ---- connecting an app ------------------------------------------------------------------------------------------------------------

  /** A new 8-digit code, good for 10 minutes and one use. Any earlier unused code of this person stops working. */
  async startPairing(adminId: string) {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
    await this.db.transaction(async (tx) => {
      await this.db.exec(
        'delete from public.import_pairings where created_by = $1 or expires_at < now()',
        [adminId],
        tx,
      );
      await this.db.exec(
        'insert into public.import_pairings (code_hash, created_by, expires_at) values ($1, $2, $3)',
        [sha(code), adminId, expiresAt.toISOString()],
        tx,
      );
    });
    await this.log.write(adminId, 'imports.pairing_started', 'gleamshelf');
    return {
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      expiresAt: expiresAt.toISOString(),
      // the address the app talks to (the API, not the website): shown next to the code
      server: (publicApiUrl() ?? `http://localhost:${port()}`).replace(/\/$/, ''),
    };
  }

  /** Trades a code for a token (shown once; only its hash is kept). */
  async pair(rawCode: string, label: string | null) {
    const now = Date.now();
    this.pairingMisses = this.pairingMisses.filter((t) => now - t < 10 * 60_000);
    if (this.pairingMisses.length >= 20)
      throw new AppError('Too many wrong codes. Wait ten minutes and ask for a new code.', 429);
    const code = rawCode.replace(/\D/g, '');
    const taken = await this.db.transaction(async (tx) => {
      const row = await this.db.one<{ created_by: string }>(
        'delete from public.import_pairings where code_hash = $1 and expires_at > now() returning created_by',
        [sha(code)],
        tx,
      );
      if (!row) return null;
      const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
      const made = await this.db.one<{ id: string }>(
        'insert into public.import_tokens (token_hash, label, created_by) values ($1, $2, $3) returning id',
        [sha(token), label?.trim() || 'Gleamshelf', row.created_by],
        tx,
      );
      return { token, id: made!.id, by: row.created_by };
    });
    if (!taken) {
      this.pairingMisses.push(now);
      throw new AppError('That code is wrong or has expired. Ask for a new one in the admin.', 400);
    }
    await this.log.write(taken.by, 'imports.app_connected', taken.id, { label });
    return { token: taken.token };
  }

  /** The token's id when it is valid and not revoked. */
  async authenticate(token: string): Promise<{ id: string } | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    const row = await this.db.one<{ id: string }>(
      'select id from public.import_tokens where token_hash = $1 and revoked_at is null',
      [sha(token)],
    );
    if (row)
      await this.db
        .exec(
          "update public.import_tokens set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')",
          [row.id],
        )
        .catch(() => undefined);
    return row;
  }

  async tokens() {
    const rows = await this.db.many<{
      id: string;
      label: string;
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
    }>(
      'select id, label, created_at, last_used_at, revoked_at from public.import_tokens order by created_at desc',
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revoked: !!r.revoked_at,
    }));
  }

  async revoke(adminId: string, id: string) {
    const done = await this.db.one<{ id: string }>(
      'update public.import_tokens set revoked_at = now() where id = $1 and revoked_at is null returning id',
      [id],
    );
    if (!done) throw notFound('Connection');
    await this.log.write(adminId, 'imports.app_disconnected', id);
  }

  // ---- what the app may read ---------------------------------------------------------------------------------------------------------

  /** The shop's own category and series lists, so the app writes into them instead of inventing its own. */
  async config() {
    const categories = await this.categories();
    return {
      // the names to choose from (a name two categories share comes with its path); a shop without its own tree yet gets the cashier's list
      categories: categories.length ? categories.map((c) => c.label) : [...PRODUCT_CATEGORIES],
      // the same categories as a tree, for an app that shows the model where each one sits
      categoryTree: categories.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        label: c.label,
      })),
      series: (await this.series.list()).map((s) => s.name),
    };
  }

  /** The shop's category tree (the website's own, under Admin → Categories), labelled. */
  private async categories(): Promise<LabelledCategory[]> {
    return labelCategories(
      await this.db.many<CategoryNode>(
        'select id, parent_id as "parentId", name from public.store_categories',
      ),
    );
  }

  // ---- drafts ------------------------------------------------------------------------------------------------------------------------

  /** Stores a draft with its photo. A draft sent again for the same source photo replaces the earlier one while it is still a draft. */
  async receive(
    tokenId: string,
    rawDraft: unknown,
    image: { buffer: Buffer; mimetype: string },
    cutout: { buffer: Buffer; mimetype: string } | null = null,
    source: { originalUrl?: string | null; productRect?: ProductRect | null } = {},
  ): Promise<{ id: string; created: boolean; status: ImportStatus; keptOriginal: boolean }> {
    const draft: DraftInput = parseDraft(rawDraft);
    if (!IMAGE_TYPES[image.mimetype])
      throw new AppError('The photo must be a WebP, JPEG or PNG image.');
    await checkCutout(cutout);
    const existing = await this.db.one<ImportRow>(
      'select * from public.product_imports where source_key = $1',
      [draft.sourceKey],
    );
    if (existing && existing.status !== 'draft')
      return { id: existing.id, created: false, status: existing.status, keptOriginal: false };
    const stored = await this.storage.uploadImage(image.buffer, image.mimetype, 'imports');
    const storedCutout = cutout
      ? (await this.storage.uploadImage(cutout.buffer, cutout.mimetype, 'imports')).url
      : null;
    // the photo as taken, and that photo cropped to the product (no AI): offered next to the photo computer's own, for a person to choose
    const originalUrl = source.originalUrl ?? null;
    const croppedUrl =
      originalUrl && source.productRect
        ? await this.cropped(originalUrl, source.productRect)
        : null;
    // when the app sent it: a draft sent again for the same photo is a new draft to review, which the admin tells apart by this
    const details = JSON.stringify({ ...draft.details, receivedAt: new Date().toISOString() });
    if (existing) {
      await this.db.exec(
        'update public.product_imports set title = $2, description = $3, category = $4, series = $5, details = $6, image_url = $7, token_id = $8, cutout_url = $9, original_url = $10, cropped_url = $11 where id = $1',
        [
          existing.id,
          draft.title,
          draft.description,
          draft.category,
          draft.series,
          details,
          stored.url,
          tokenId,
          storedCutout,
          originalUrl,
          croppedUrl,
        ],
      );
      await this.storage
        .deleteImages(
          [
            existing.image_url,
            existing.cutout_url,
            existing.original_url,
            existing.cropped_url,
          ].filter((u): u is string => !!u && u !== originalUrl),
        )
        .catch(() => undefined);
      return {
        id: existing.id,
        created: false,
        status: 'draft' as const,
        keptOriginal: !!originalUrl,
      };
    }
    const row = await this.db.one<{ id: string }>(
      'insert into public.product_imports (source_key, title, description, category, series, details, image_url, token_id, cutout_url, original_url, cropped_url) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id',
      [
        draft.sourceKey,
        draft.title,
        draft.description,
        draft.category,
        draft.series,
        details,
        stored.url,
        tokenId,
        storedCutout,
        originalUrl,
        croppedUrl,
      ],
    );
    return { id: row!.id, created: true, status: 'draft' as const, keptOriginal: !!originalUrl };
  }

  /** The original photo cropped to the product, stored; null when it cannot be made (a crop is a nice extra, never a reason to lose the draft). */
  private async cropped(originalUrl: string, rect: ProductRect): Promise<string | null> {
    try {
      const bytes = await cropToProduct(await downloadPhoto(originalUrl), rect);
      return (await this.storage.uploadImage(bytes, 'image/jpeg', 'imports')).url;
    } catch {
      return null;
    }
  }

  async list(status: ImportStatus) {
    const rows = await this.db.many<ImportRow>(
      'select * from public.product_imports where status = $1 order by created_at desc limit 200',
      [status],
    );
    const counts = await this.db.many<{ status: ImportStatus; n: number }>(
      'select status, count(*)::int as n from public.product_imports group by status',
    );
    // a draft of a product the shop already has: shown with the listing(s) it most likely is, so the photo can become more stock instead
    const products = status === 'draft' && rows.length ? await this.shopProducts() : [];
    const categories = await this.categories();
    return {
      imports: rows.map((r) => ({
        ...present(r, categories),
        matches: status === 'draft' ? this.matchesFor(r, products) : [],
      })),
      counts: Object.fromEntries(
        IMPORT_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0]),
      ),
    };
  }

  /** Every product the shop has (hidden ones too: a hidden listing is still the same product), with what a person needs to tell them apart. */
  async shopProducts(): Promise<ShopProduct[]> {
    const rows = await this.db.many<{
      id: string;
      name: string;
      series: string | null;
      character: string | null;
      stock_count: number | null;
      image_url: string | null;
      hidden: boolean;
    }>(
      `select p.square_item_id as id, p.name, m.series, m.character, i.quantity as stock_count,
              (select pi.image_url from public.product_images pi where pi.square_item_id = p.square_item_id order by pi.sort_order limit 1) as image_url,
              (not p.is_visible or coalesce(m.availability, 'auto') = 'hidden') as hidden
         from public.catalog_products p
         left join public.product_metadata m on m.square_item_id = p.square_item_id
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
        where p.is_active`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      series: r.series,
      character: r.character,
      stockCount: r.stock_count,
      imageUrl: r.image_url,
      hidden: r.hidden,
    }));
  }

  matchesFor(
    row: Pick<ImportRow, 'title' | 'series' | 'details'>,
    products: ShopProduct[],
  ): ProductMatch[] {
    const lookup = (row.details as { lookup?: { read?: string | null } | null }).lookup;
    return likelySameProducts(
      { title: row.title, series: row.series, read: lookup?.read ?? null },
      products,
    );
  }

  /**
   * The draft is a product the shop already has: its units are added to that product's stock (the same add-stock as the Products screen) and the
   * draft is closed as handled, pointing at that product. No second listing is made, and the draft's photo is not used.
   */
  async restock(adminId: string, id: string, productId: string, quantity: number) {
    const row = await this.db.one<ImportRow>('select * from public.product_imports where id = $1', [
      id,
    ]);
    if (!row) throw notFound('Draft');
    if (row.status !== 'draft') throw new AppError(`This draft was already ${row.status}.`, 409);
    const claimed = await this.db.one<{ id: string }>(
      "update public.product_imports set status = 'added', decided_by = $2, decided_at = now(), square_item_id = $3 where id = $1 and status = 'draft' returning id",
      [id, adminId, productId],
    );
    if (!claimed) throw new AppError('Someone else just handled this draft.', 409);
    try {
      const stockCount = await this.quickAdd.addStock(adminId, productId, quantity);
      await this.storage
        .deleteImages(
          [row.image_url, row.cutout_url, row.original_url, row.cropped_url].filter(
            (u): u is string => !!u,
          ),
        )
        .catch(() => undefined);
      await this.db.exec(
        "update public.product_imports set image_url = null, cutout_url = null, original_url = null, cropped_url = null, edited_photos = '{}'::jsonb where id = $1",
        [id],
      );
      await this.log.write(adminId, 'imports.restocked', id, { productId, quantity, stockCount });
      return { productId, stockCount };
    } catch (error) {
      await this.db.exec(
        "update public.product_imports set status = 'draft', decided_by = null, decided_at = null, square_item_id = null where id = $1",
        [id],
      );
      throw error;
    }
  }

  async get(id: string) {
    const row = await this.db.one<ImportRow>('select * from public.product_imports where id = $1', [
      id,
    ]);
    if (!row) throw notFound('Draft');
    return present(row, await this.categories());
  }

  /**
   * Adds the draft as a product through the normal quick add (Square item, series, storefront details; undone again if any step fails), with the
   * photos a person chose and whatever the staff member typed. Each photo the draft offers (the photo computer's studio photo, the product on one of
   * the shop's backgrounds, the photo as taken, that photo cropped to the product, the maker's official photo) can go to Square (the website and the
   * till), to eBay (kept for when it is connected), to both or to neither, in the order given. The draft stays a draft if anything fails.
   */
  async add(
    adminId: string,
    id: string,
    dto: QuickAddDto,
    photo: 'own' | 'official' | 'both' = 'own',
    backgroundChoice?: string | null,
    picked?: PhotoChoice[] | null,
  ) {
    const row = await this.db.one<ImportRow>('select * from public.product_imports where id = $1', [
      id,
    ]);
    if (!row) throw notFound('Draft');
    if (row.status !== 'draft') throw new AppError(`This draft was already ${row.status}.`, 409);
    if (!row.image_url) throw new AppError('This draft has no photo any more.', 409);
    const available = new Set(draftPhotos(row).map((p) => p.key));
    // the cut-out is saved transparent and shows on the shop background; a background chosen by an older admin (`backgroundChoice`) is not needed
    void backgroundChoice;
    const choices = picked?.length ? picked : legacyChoices(photo, !!row.cutout_url);
    for (const c of choices)
      if (!available.has(c.key))
        throw new AppError(
          c.key === 'official'
            ? 'This draft has no official photo to use.'
            : `This draft has no "${c.key}" photo.`,
          409,
        );
    if (!choices.some((c) => c.square || c.ebay)) throw new AppError('Choose at least one photo.');
    const claimed = await this.db.one<{ id: string }>(
      "update public.product_imports set status = 'added', decided_by = $2, decided_at = now() where id = $1 and status = 'draft' returning id",
      [id, adminId],
    );
    if (!claimed) throw new AppError('Someone else just handled this draft.', 409);
    const made: string[] = []; // files made for this add (the official copy, the photo on its background, eBay's copies): removed if it fails
    try {
      // each chosen photo as a file in our storage
      const urls = new Map<PhotoKey, string>();
      const edits = editsOf(row);
      for (const c of choices) {
        if (urls.has(c.key)) continue;
        if (edits[c.key]) urls.set(c.key, edits[c.key]!);
        else if (c.key === 'studio') urls.set(c.key, row.image_url);
        else if (c.key === 'original') urls.set(c.key, row.original_url!);
        else if (c.key === 'cropped') urls.set(c.key, row.cropped_url!);
        else if (isOfficialKey(c.key)) {
          const offered = draftPhotos({ ...row, edited_photos: {} }).find(
            (p) => p.key === c.key,
          )!.url;
          const copy = await this.copyOfficialPhoto(offered);
          made.push(copy);
          urls.set(c.key, copy);
        } else {
          // the cut-out: the product on a transparent square, shown on the shop background
          const transparent = (
            await this.storage.uploadImage(
              await this.backgrounds.transparent(row.cutout_url!),
              'image/png',
              'imports',
            )
          ).url;
          made.push(transparent);
          urls.set(c.key, transparent);
        }
      }
      // eBay keeps its own copies (Square's are deleted from our storage once Square has them). The cut-out stays a cut-out: eBay cannot show
      // transparency, so it is given the cut-out on the shop background when it fetches the photo, and again after the background changes.
      const ebay: { url: string; cutout: boolean }[] = [];
      for (const c of choices.filter((x) => x.ebay)) {
        const cutout = c.key === 'background';
        const copy = (
          cutout
            ? await this.storage.uploadImage(
                await downloadPhoto(row.cutout_url!),
                'image/png',
                'channels',
              )
            : await this.storage.uploadImage(
                await sharp(await downloadPhoto(urls.get(c.key)!))
                  .rotate()
                  .flatten({ background: '#ffffff' })
                  .jpeg({ quality: 92 })
                  .toBuffer(),
                'image/jpeg',
                'channels',
              )
        ).url;
        made.push(copy);
        ebay.push({ url: copy, cutout });
      }
      const square = choices.filter((c) => c.square);
      dto.imageUrls = square.map((c) => urls.get(c.key)!);
      // without Square (a local copy of the shop with no keys) the product is kept by the shop alone, like one added by hand
      const inSquare = !!(squareAccessToken() && squareLocationId());
      const product = inSquare
        ? await this.quickAdd.add(adminId, dto)
        : await this.merch.create(adminId, dto);
      await this.db.exec(
        "update public.product_imports set square_item_id = $2, image_url = null, cutout_url = null, original_url = null, cropped_url = null, edited_photos = '{}'::jsonb where id = $1",
        [id, product.id],
      );
      for (const [i, e] of ebay.entries())
        await this.db.exec(
          'insert into public.channel_photos (square_item_id, channel, image_url, position, cutout) values ($1, $2, $3, $4, $5) on conflict do nothing',
          [product.id, 'ebay', e.url, i, e.cutout],
        );
      // the files Square did not take (the quick add deletes the ones it sent) are not needed any more
      const sent = new Set(dto.imageUrls);
      const unused = [
        row.image_url,
        row.original_url,
        row.cropped_url,
        ...Object.values(editsOf(row)),
        ...made.filter((u) => !ebay.some((e) => e.url === u)),
      ].filter((u): u is string => !!u && !sent.has(u));
      await this.storage.deleteImages(unused).catch(() => undefined);
      // the cut-out stays with the product, behind the Square photo made from it: eBay and link previews are made from it, and a white square can
      // be made transparent later
      if (row.cutout_url) {
        const at = square.findIndex((c) => c.key === 'background' || c.key === 'studio');
        // a photo kept by the shop alone is known by its address (it has no Square id)
        const kept =
          at >= 0 ? (inSquare ? await this.photoIdAt(product.id, at) : dto.imageUrls[at]) : null;
        if (kept)
          await this.backgrounds.remember(
            product.id,
            kept,
            row.cutout_url,
            square[at].key === 'background',
          );
        else await this.storage.deleteImages([row.cutout_url]).catch(() => undefined);
      }
      await this.log.write(adminId, 'imports.added', id, {
        productId: product.id,
        square: square.map((c) => c.key),
        ebay: choices.filter((c) => c.ebay).map((c) => c.key),
        transparent: choices.some((c) => c.key === 'background'),
      });
      return product;
    } catch (error) {
      await this.storage.deleteImages(made).catch(() => undefined);
      await this.db.exec(
        "update public.product_imports set status = 'draft', decided_by = null, decided_at = null where id = $1",
        [id],
      );
      throw error;
    }
  }

  /** The Square id of a new product's photo at this place in its list, or null when Square cannot say. */
  private async photoIdAt(productId: string, index: number): Promise<string | null> {
    try {
      return (await this.photos.list(productId)).shown[index]?.id ?? null;
    } catch {
      return null;
    }
  }

  /** A draft's photo as bytes, for the admin's photo editor (the edited one unless `asOffered`). Never any other address: only this draft's own photos. */
  async photoFile(
    id: string,
    key: PhotoKey,
    asOffered = false,
  ): Promise<{ bytes: Buffer; type: string }> {
    const row = await this.draftRow(id);
    const photo = draftPhotos(row).find((p) => p.key === key);
    if (!photo || key === 'background')
      throw new AppError('This draft has no such photo to edit.', 404);
    const url = asOffered
      ? (draftPhotos({ ...row, edited_photos: {} }).find((p) => p.key === key)?.url ?? photo.url)
      : photo.url;
    if (isOfficialKey(key) && !editsOf(row)[key]) return this.fetchOfficial(url);
    const bytes = await downloadPhoto(url);
    return {
      bytes,
      type:
        (
          await sharp(bytes)
            .metadata()
            .catch(() => null)
        )?.format === 'png'
          ? 'image/png'
          : 'image/jpeg',
    };
  }

  /** Keeps a person's edit of one of the draft's photos (the photo as offered stays, so the edit can be undone). */
  async editPhoto(adminId: string, id: string, key: PhotoKey, bytes: Buffer, contentType: string) {
    const row = await this.draftRow(id);
    if (row.status !== 'draft') throw new AppError(`This draft was already ${row.status}.`, 409);
    if (key === 'background' || !draftPhotos(row).some((p) => p.key === key))
      throw new AppError('This photo cannot be edited here.', 400);
    const stored = (await this.storage.uploadImage(bytes, contentType, 'imports')).url;
    const before = editsOf(row)[key];
    await this.db.exec(
      'update public.product_imports set edited_photos = edited_photos || jsonb_build_object($2::text, $3::text) where id = $1',
      [id, key, stored],
    );
    if (before) await this.storage.deleteImages([before]).catch(() => undefined);
    await this.log.write(adminId, 'imports.photo_edited', id, { photo: key });
    return present(await this.draftRow(id), await this.categories());
  }

  /** Undoes the edit of one photo: the photo as offered is used again. */
  async undoEdit(adminId: string, id: string, key: PhotoKey) {
    const row = await this.draftRow(id);
    const before = editsOf(row)[key];
    if (!before) throw new AppError('This photo has no edit to undo.', 404);
    await this.db.exec(
      'update public.product_imports set edited_photos = edited_photos - $2 where id = $1',
      [id, key],
    );
    await this.storage.deleteImages([before]).catch(() => undefined);
    await this.log.write(adminId, 'imports.photo_edit_undone', id, { photo: key });
    return present(await this.draftRow(id), await this.categories());
  }

  private async draftRow(id: string): Promise<ImportRow> {
    const row = await this.db.one<ImportRow>('select * from public.product_imports where id = $1', [
      id,
    ]);
    if (!row) throw notFound('Draft');
    return row;
  }

  /** The maker's photo, read from the maker's own site only (no redirect elsewhere). */
  private async fetchOfficial(url: string): Promise<{ bytes: Buffer; type: string }> {
    if (!isOfficialUrl(url))
      throw new AppError("The official photo is not on a maker's site.", 400);
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) }).catch(
      () => null,
    );
    const type = (res?.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res?.ok || !IMAGE_TYPES[type])
      throw new AppError("The maker's photo could not be downloaded.", 502);
    return { bytes: Buffer.from(await res.arrayBuffer()), type };
  }

  /** A copy of the maker's photo in our own storage, so the quick add treats it like any other photo. Only makers' official sites, never a redirect elsewhere. */
  private async copyOfficialPhoto(url: string): Promise<string> {
    if (!isOfficialUrl(url))
      throw new AppError("The official photo is not on a maker's site.", 400);
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) }).catch(
      () => null,
    );
    const type = (res?.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res?.ok || !IMAGE_TYPES[type])
      throw new AppError("The maker's photo could not be downloaded.", 502);
    const bytes = Buffer.from(await res.arrayBuffer());
    return (await this.storage.uploadImage(bytes, type, 'imports')).url;
  }

  async reject(adminId: string, id: string, reason: string | null) {
    const row = await this.db.one<ImportRow>(
      "update public.product_imports set status = 'rejected', decided_by = $2, decided_at = now(), reject_reason = $3 where id = $1 and status = 'draft' returning *",
      [id, adminId, reason],
    );
    if (!row) {
      if (!(await this.db.one('select 1 from public.product_imports where id = $1', [id])))
        throw notFound('Draft');
      throw new AppError('This draft was already handled.', 409);
    }
    await this.storage
      .deleteImages(
        [row.image_url, row.cutout_url, row.original_url, row.cropped_url].filter(
          (u): u is string => !!u,
        ),
      )
      .catch(() => undefined);
    await this.db.exec(
      "update public.product_imports set image_url = null, cutout_url = null, original_url = null, cropped_url = null, edited_photos = '{}'::jsonb where id = $1",
      [id],
    );
    await this.log.write(adminId, 'imports.rejected', id, { reason });
  }
}
