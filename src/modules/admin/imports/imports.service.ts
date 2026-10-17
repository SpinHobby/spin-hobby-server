import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { port, publicApiUrl } from '../../../config/app.config.js';
import { PRODUCT_CATEGORIES } from '../../cashier/product-categories.js';
import { AdminLog } from '../admin-log.service.js';
import type { QuickAddDto } from '../products/dto/quick-add.dto.js';
import { PhotoBackgroundsService } from '../products/photo-backgrounds.service.js';
import { QuickAddService } from '../products/quick-add.service.js';
import { SquarePhotosService } from '../products/square-photos.service.js';
import { checkCutout } from './photo-jobs.service.js';
import { SeriesService } from '../series/series.service.js';
import { isOfficialUrl, parseDraft, type DraftInput, type OfficialPhoto } from './draft.js';
import { likelySameProducts, type ProductMatch, type ShopProduct } from './duplicates.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const TOKEN_PREFIX = 'gst_';
const PAIRING_MINUTES = 10;

export type ImportStatus = 'draft' | 'added' | 'rejected';
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
  square_item_id: string | null;
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

const present = (r: ImportRow) => ({
  id: r.id,
  status: r.status,
  title: r.title,
  description: r.description,
  category: r.category,
  series: r.series,
  details: r.details,
  imageUrl: r.image_url,
  // the product alone on a transparent background, to put on one of the shop's backgrounds
  cutoutUrl: r.image_url ? r.cutout_url : null,
  productId: r.square_item_id,
  rejectReason: r.reject_reason,
  createdAt: r.created_at,
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
    return {
      categories: [...PRODUCT_CATEGORIES],
      series: (await this.series.list()).map((s) => s.name),
    };
  }

  // ---- drafts ------------------------------------------------------------------------------------------------------------------------

  /** Stores a draft with its photo. A draft sent again for the same source photo replaces the earlier one while it is still a draft. */
  async receive(
    tokenId: string,
    rawDraft: unknown,
    image: { buffer: Buffer; mimetype: string },
    cutout: { buffer: Buffer; mimetype: string } | null = null,
  ) {
    const draft: DraftInput = parseDraft(rawDraft);
    if (!IMAGE_TYPES[image.mimetype])
      throw new AppError('The photo must be a WebP, JPEG or PNG image.');
    await checkCutout(cutout);
    const existing = await this.db.one<ImportRow>(
      'select * from public.product_imports where source_key = $1',
      [draft.sourceKey],
    );
    if (existing && existing.status !== 'draft')
      return { id: existing.id, created: false, status: existing.status };
    const stored = await this.storage.uploadImage(image.buffer, image.mimetype, 'imports');
    const storedCutout = cutout
      ? (await this.storage.uploadImage(cutout.buffer, cutout.mimetype, 'imports')).url
      : null;
    const details = JSON.stringify(draft.details);
    if (existing) {
      await this.db.exec(
        'update public.product_imports set title = $2, description = $3, category = $4, series = $5, details = $6, image_url = $7, token_id = $8, cutout_url = $9 where id = $1',
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
        ],
      );
      await this.storage
        .deleteImages([existing.image_url, existing.cutout_url].filter((u): u is string => !!u))
        .catch(() => undefined);
      return { id: existing.id, created: false, status: 'draft' as const };
    }
    const row = await this.db.one<{ id: string }>(
      'insert into public.product_imports (source_key, title, description, category, series, details, image_url, token_id, cutout_url) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id',
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
      ],
    );
    return { id: row!.id, created: true, status: 'draft' as const };
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
    return {
      imports: rows.map((r) => ({
        ...present(r),
        matches: status === 'draft' ? this.matchesFor(r, products) : [],
      })),
      categories: [...PRODUCT_CATEGORIES],
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
        .deleteImages([row.image_url, row.cutout_url].filter((u): u is string => !!u))
        .catch(() => undefined);
      await this.db.exec(
        'update public.product_imports set image_url = null, cutout_url = null where id = $1',
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
    return present(row);
  }

  /**
   * Adds the draft as a product through the normal quick add (Square item, series, storefront details; undone again if any step fails), with the
   * draft's photo and whatever the staff member typed. The draft stays a draft if anything fails.
   */
  async add(
    adminId: string,
    id: string,
    dto: QuickAddDto,
    photo: 'own' | 'official' | 'both' = 'own',
    backgroundChoice?: string | null,
  ) {
    const row = await this.db.one<ImportRow>('select * from public.product_imports where id = $1', [
      id,
    ]);
    if (!row) throw notFound('Draft');
    if (row.status !== 'draft') throw new AppError(`This draft was already ${row.status}.`, 409);
    if (!row.image_url) throw new AppError('This draft has no photo any more.', 409);
    const official = (row.details as { official?: OfficialPhoto | null }).official ?? null;
    if (photo !== 'own' && !official)
      throw new AppError('This draft has no official photo to use.', 409);
    // the shop's own photo on one of its backgrounds, from the draft's cut-out: checked before anything changes
    const ownOnBackground = photo !== 'official' && !!row.cutout_url;
    const background = ownOnBackground ? await this.backgrounds.resolve(backgroundChoice) : null;
    const compose = ownOnBackground && (!!background || backgroundChoice === null);
    const claimed = await this.db.one<{ id: string }>(
      "update public.product_imports set status = 'added', decided_by = $2, decided_at = now() where id = $1 and status = 'draft' returning id",
      [id, adminId],
    );
    if (!claimed) throw new AppError('Someone else just handled this draft.', 409);
    let officialCopy: string | null = null;
    let composed: string | null = null;
    try {
      if (photo !== 'own') officialCopy = await this.copyOfficialPhoto(official!.imageUrl);
      if (compose)
        composed = (
          await this.storage.uploadImage(
            await this.backgrounds.compose(row.cutout_url!, background),
            'image/jpeg',
            'imports',
          )
        ).url;
      const own = composed ?? row.image_url;
      dto.imageUrls =
        photo === 'official' ? [officialCopy!] : photo === 'both' ? [own, officialCopy!] : [own];
      const product = await this.quickAdd.add(adminId, dto);
      await this.db.exec(
        'update public.product_imports set square_item_id = $2, image_url = null, cutout_url = null where id = $1',
        [id, product.id],
      );
      // the white-square photo was not used (another photo or a background took its place): it is not needed any more
      if (photo === 'official' || composed)
        await this.storage.deleteImages([row.image_url]).catch(() => undefined);
      // the cut-out stays with the product, behind its first photo, so the background can be changed later
      if (row.cutout_url) {
        const kept = photo === 'official' ? null : await this.firstPhotoId(product.id);
        if (kept)
          await this.backgrounds.remember(product.id, kept, row.cutout_url, background?.id ?? null);
        else await this.storage.deleteImages([row.cutout_url]).catch(() => undefined);
      }
      await this.log.write(adminId, 'imports.added', id, {
        productId: product.id,
        photo,
        background: compose ? (background?.name ?? 'white') : null,
      });
      return product;
    } catch (error) {
      if (officialCopy) await this.storage.deleteImages([officialCopy]).catch(() => undefined);
      if (composed) await this.storage.deleteImages([composed]).catch(() => undefined);
      await this.db.exec(
        "update public.product_imports set status = 'draft', decided_by = null, decided_at = null where id = $1",
        [id],
      );
      throw error;
    }
  }

  /** The id of a new product's first photo in Square (the shop's own photo is put first), or null when Square cannot say. */
  private async firstPhotoId(productId: string): Promise<string | null> {
    try {
      return (await this.photos.list(productId)).shown[0]?.id ?? null;
    } catch {
      return null;
    }
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
      .deleteImages([row.image_url, row.cutout_url].filter((u): u is string => !!u))
      .catch(() => undefined);
    await this.db.exec(
      'update public.product_imports set image_url = null, cutout_url = null where id = $1',
      [id],
    );
    await this.log.write(adminId, 'imports.rejected', id, { reason });
  }
}
