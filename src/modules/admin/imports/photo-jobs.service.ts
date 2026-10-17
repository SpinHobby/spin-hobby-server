import { Injectable } from '@nestjs/common';
import { AppError, errorText, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminLog } from '../admin-log.service.js';
import { downloadPhoto } from '../products/download-photo.js';
import { hasTransparency } from '../products/compose-photo.js';
import { PhotoBackgroundsService } from '../products/photo-backgrounds.service.js';
import { SquarePhotosService } from '../products/square-photos.service.js';
import {
  parseJobDetails,
  parsePhotoOptions,
  type PhotoJobDetails,
  type PhotoJobOptions,
} from './photo-job-options.js';

const LEASE_MINUTES = 30;
const MAX_ATTEMPTS = 3;
const MAX_PRODUCTS = 100;
/** A worker that has asked for work in the last five minutes counts as connected. */
const ONLINE_SECONDS = 300;

export type JobStatus =
  'queued' | 'running' | 'done' | 'failed' | 'applied' | 'rejected' | 'cancelled';
const STATUSES: JobStatus[] = [
  'queued',
  'running',
  'done',
  'failed',
  'applied',
  'rejected',
  'cancelled',
];

interface JobRow {
  id: string;
  batch_id: string;
  square_item_id: string;
  product_name: string;
  image_id: string;
  source_url: string;
  status: JobStatus;
  attempts: number;
  result_url: string | null;
  cutout_url: string | null;
  details: Partial<PhotoJobDetails>;
  error: string | null;
  created_at: string;
  progress: number | null;
  step: string | null;
  started_at: string | null;
  decided_at: string | null;
}

const present = (r: JobRow) => ({
  id: r.id,
  batchId: r.batch_id,
  productId: r.square_item_id,
  productName: r.product_name,
  status: r.status,
  before: r.source_url,
  after: r.result_url,
  // the product alone on a transparent background: it can be put on one of the shop's backgrounds when the photo is used
  cutout: r.result_url ? r.cutout_url : null,
  flags: r.details.flags ?? [],
  notes: r.details.notes ?? [],
  seconds: r.details.seconds ?? null,
  error: r.error,
  progress: r.status === 'running' ? (r.progress ?? 0) : null,
  step: r.status === 'running' ? r.step : null,
  startedAt: r.status === 'running' ? r.started_at : null,
  decidedAt: r.decided_at,
});

/**
 * The queue of photos to improve. An admin sends products' photos into it; a Gleamshelf app takes them one at a time (a job is leased to one worker for 30 minutes,
 * and goes back in the queue if the worker disappears), and sends back the improved photo. A person looks at each before and after and approves: only then does
 * the product change, through the same photo editing the admin uses by hand (the new photo takes the old one's place, the original is hidden, never deleted).
 */
@Injectable()
export class PhotoJobsService {
  constructor(
    private readonly db: Db,
    private readonly photos: SquarePhotosService,
    private readonly storage: StorageService,
    private readonly log: AdminLog,
    private readonly backgrounds: PhotoBackgroundsService,
  ) {}

  // ---- the admin sends photos in ----------------------------------------------------------------------------------------------------

  async createBatch(
    adminId: string,
    productIds: string[],
    scope: 'main' | 'all',
    rawOptions: unknown,
  ) {
    const ids = [...new Set(productIds)];
    if (!ids.length) throw new AppError('Choose at least one product.');
    if (ids.length > MAX_PRODUCTS)
      throw new AppError(`Choose at most ${MAX_PRODUCTS} products at a time.`);
    const options = parsePhotoOptions(rawOptions);
    const names = new Map(
      (
        await this.db.many<{ square_item_id: string; name: string }>(
          'select square_item_id, name from public.catalog_products where square_item_id = any($1::text[])',
          [ids],
        )
      ).map((r) => [r.square_item_id, r.name]),
    );
    const wanted: { productId: string; name: string; imageId: string; url: string }[] = [];
    const skipped: { productId: string; name: string; reason: string }[] = [];
    for (const id of ids) {
      const name = names.get(id) ?? 'Product';
      try {
        const { shown } = await this.photos.list(id);
        if (!shown.length) skipped.push({ productId: id, name, reason: 'it has no photos' });
        for (const p of scope === 'main' ? shown.slice(0, 1) : shown)
          wanted.push({ productId: id, name, imageId: p.id, url: p.url });
      } catch (e) {
        skipped.push({
          productId: id,
          name,
          reason: e instanceof AppError ? e.message : errorText(e),
        });
      }
    }
    if (!wanted.length) return { batchId: null, queued: 0, alreadyQueued: 0, skipped };
    const batch = await this.db.one<{ id: string }>(
      'insert into public.photo_batches (created_by, options, scope) values ($1, $2, $3) returning id',
      [adminId, JSON.stringify(options), scope],
    );
    let queued = 0;
    for (const w of wanted) {
      const made = await this.db.one<{ id: string }>(
        'insert into public.photo_jobs (batch_id, square_item_id, product_name, image_id, source_url) values ($1, $2, $3, $4, $5) on conflict do nothing returning id',
        [batch!.id, w.productId, w.name, w.imageId, w.url],
      );
      if (made) queued++;
    }
    if (!queued) await this.db.exec('delete from public.photo_batches where id = $1', [batch!.id]);
    await this.log.write(adminId, 'photos.batch_created', batch!.id, {
      products: ids.length,
      photos: queued,
      options,
    });
    return {
      batchId: queued ? batch!.id : null,
      queued,
      alreadyQueued: wanted.length - queued,
      skipped,
    };
  }

  // ---- what the admin sees ----------------------------------------------------------------------------------------------------------

  async batches() {
    const rows = await this.db.many<{
      id: string;
      created_at: string;
      scope: string;
      options: PhotoJobOptions;
      counts: Record<string, number>;
    }>(
      `select b.id, b.created_at, b.scope, b.options,
              coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int as n from public.photo_jobs where batch_id = b.id group by status) c), '{}'::jsonb) as counts
         from public.photo_batches b order by b.created_at desc limit 30`,
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      scope: r.scope,
      options: r.options,
      counts: Object.fromEntries(STATUSES.map((s) => [s, r.counts[s] ?? 0])) as Record<
        JobStatus,
        number
      >,
    }));
  }

  async batch(id: string) {
    const b = await this.db.one<{
      id: string;
      created_at: string;
      scope: string;
      options: PhotoJobOptions;
    }>('select id, created_at, scope, options from public.photo_batches where id = $1', [id]);
    if (!b) throw notFound('Batch');
    const jobs = await this.db.many<JobRow>(
      'select * from public.photo_jobs where batch_id = $1 order by product_name, created_at',
      [id],
    );
    return {
      id: b.id,
      createdAt: b.created_at,
      scope: b.scope,
      options: b.options,
      jobs: jobs.map(present),
    };
  }

  /** The connected Gleamshelf apps, and whether each has asked for work lately. */
  async workers() {
    const rows = await this.db.many<{
      id: string;
      label: string;
      last_used_at: string | null;
      features: string[];
      running: number;
    }>(
      `select t.id, t.label, t.last_used_at, t.features,
              (select count(*)::int from public.photo_jobs j where j.worker_id = t.id and j.status = 'running') as running
         from public.import_tokens t where t.revoked_at is null order by t.last_used_at desc nulls last`,
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      lastSeen: r.last_used_at,
      online: !!r.last_used_at && now - Date.parse(r.last_used_at) < ONLINE_SECONDS * 1000,
      canImprovePhotos: r.features.includes('photo'),
      working: r.running,
    }));
  }

  // ---- what the admin decides --------------------------------------------------------------------------------------------------------

  /**
   * Puts the improved photo on the product in the old one's place. The job stays "done" if Square refuses, so it can be tried again. With a cut-out
   * and a background (chosen, or the shop's default when none is chosen) the photo is the product placed on it; otherwise (null: white) it is the photo
   * computer's own white square. The cut-out is kept with the product either way, so its background can be changed later.
   */
  async apply(adminId: string, jobId: string, backgroundChoice?: string | null) {
    const job = await this.db.one<JobRow>('select * from public.photo_jobs where id = $1', [jobId]);
    if (!job) throw notFound('Photo job');
    if (job.status !== 'done' || !job.result_url)
      throw new AppError(
        job.status === 'applied'
          ? 'This photo was already used.'
          : 'This photo is not ready to use.',
        409,
      );
    // the background is checked before anything changes: one deleted from the library meanwhile is refused, not quietly swapped for white
    const background = job.cutout_url ? await this.backgrounds.resolve(backgroundChoice) : null;
    const claimed = await this.db.one<{ id: string }>(
      "update public.photo_jobs set status = 'applied', decided_by = $2, decided_at = now() where id = $1 and status = 'done' returning id",
      [jobId, adminId],
    );
    if (!claimed) throw new AppError('Someone else just handled this photo.', 409);
    try {
      const photo =
        job.cutout_url && background
          ? await this.backgrounds.compose(job.cutout_url, background)
          : await downloadPhoto(job.result_url);
      const { created } = await this.photos.add(adminId, job.square_item_id, photo, job.image_id);
      if (job.cutout_url)
        await this.backgrounds.remember(
          job.square_item_id,
          created,
          job.cutout_url,
          background?.id ?? null,
        );
    } catch (error) {
      await this.db.exec(
        "update public.photo_jobs set status = 'done', decided_by = null, decided_at = null where id = $1",
        [jobId],
      );
      throw error;
    }
    await this.storage.deleteImages([job.result_url]).catch(() => undefined);
    // the cut-out now belongs to the product (product_cutouts), not to the job
    await this.db.exec(
      'update public.photo_jobs set result_url = null, cutout_url = null where id = $1',
      [jobId],
    );
    await this.log.write(adminId, 'photos.job_applied', job.square_item_id, {
      jobId,
      imageId: job.image_id,
      background: job.cutout_url ? (background?.name ?? 'white') : null,
    });
  }

  /** Uses every finished photo of a batch (or just the ones named), one after the other; the ones Square refuses are reported and stay waiting. */
  async applyMany(
    adminId: string,
    batchId: string,
    only?: string[],
    backgroundChoice?: string | null,
  ) {
    const jobs = await this.db.many<{ id: string; product_name: string }>(
      "select id, product_name from public.photo_jobs where batch_id = $1 and status = 'done' order by product_name, created_at",
      [batchId],
    );
    const chosen = only ? jobs.filter((j) => only.includes(j.id)) : jobs;
    let applied = 0;
    const failed: { id: string; product: string; error: string }[] = [];
    for (const j of chosen) {
      try {
        await this.apply(adminId, j.id, backgroundChoice);
        applied++;
      } catch (e) {
        failed.push({
          id: j.id,
          product: j.product_name,
          error: e instanceof AppError ? e.message : errorText(e),
        });
      }
    }
    return { applied, failed };
  }

  async reject(adminId: string, jobId: string) {
    const job = await this.db.one<JobRow>(
      "update public.photo_jobs set status = 'rejected', decided_by = $2, decided_at = now() where id = $1 and status in ('done', 'failed') returning *",
      [jobId, adminId],
    );
    if (!job) {
      if (!(await this.db.one('select 1 from public.photo_jobs where id = $1', [jobId])))
        throw notFound('Photo job');
      throw new AppError('This photo cannot be rejected now.', 409);
    }
    await this.storage
      .deleteImages([job.result_url, job.cutout_url].filter((u): u is string => !!u))
      .catch(() => undefined);
    await this.db.exec(
      'update public.photo_jobs set result_url = null, cutout_url = null where id = $1',
      [jobId],
    );
    await this.log.write(adminId, 'photos.job_rejected', job.square_item_id, { jobId });
  }

  /** Puts a failed or rejected photo back in the queue. */
  async retry(adminId: string, jobId: string) {
    const job = await this.db.one<{ square_item_id: string }>(
      "update public.photo_jobs set status = 'queued', attempts = 0, error = null, lease_until = null, worker_id = null, result_url = null, cutout_url = null, decided_by = null, decided_at = null where id = $1 and status in ('failed', 'rejected') returning square_item_id",
      [jobId],
    );
    if (!job) {
      if (!(await this.db.one('select 1 from public.photo_jobs where id = $1', [jobId])))
        throw notFound('Photo job');
      throw new AppError('Only a failed or rejected photo can be tried again.', 409);
    }
    await this.log.write(adminId, 'photos.job_retried', job.square_item_id, { jobId });
  }

  /** Takes what has not started out of the queue. Photos already being worked on or finished are left alone. */
  async cancelBatch(adminId: string, batchId: string) {
    if (!(await this.db.one('select 1 from public.photo_batches where id = $1', [batchId])))
      throw notFound('Batch');
    const n = await this.db.one<{ n: number }>(
      "with c as (update public.photo_jobs set status = 'cancelled' where batch_id = $1 and status = 'queued' returning 1) select count(*)::int as n from c",
      [batchId],
    );
    await this.log.write(adminId, 'photos.batch_cancelled', batchId, { cancelled: n?.n ?? 0 });
    return { cancelled: n?.n ?? 0 };
  }

  // ---- what a worker does -------------------------------------------------------------------------------------------------------------

  /** The next photo to improve, leased to this worker; null when there is none (or the worker cannot do photos). Also notes that the worker is alive. */
  async claim(tokenId: string, features: string[]) {
    await this.db.exec(
      'update public.import_tokens set features = $2, last_used_at = now() where id = $1',
      [tokenId, features.slice(0, 10)],
    );
    if (!features.includes('photo')) return null;
    return this.db.transaction(async (tx) => {
      // a worker that took a job and vanished: the job goes back, up to three times
      await this.db.exec(
        "update public.photo_jobs set status = 'queued', lease_until = null, worker_id = null, progress = null, step = null, started_at = null where status = 'running' and lease_until < now() and attempts < $1",
        [MAX_ATTEMPTS],
        tx,
      );
      await this.db.exec(
        "update public.photo_jobs set status = 'failed', error = 'The photo computer stopped answering three times.', lease_until = null where status = 'running' and lease_until < now() and attempts >= $1",
        [MAX_ATTEMPTS],
        tx,
      );
      const next = await this.db.one<JobRow & { options: PhotoJobOptions }>(
        `select j.*, b.options from public.photo_jobs j join public.photo_batches b on b.id = j.batch_id
          where j.status = 'queued' order by j.created_at limit 1 for update of j skip locked`,
        [],
        tx,
      );
      if (!next) return null;
      await this.db.exec(
        `update public.photo_jobs set status = 'running', attempts = attempts + 1, worker_id = $2, progress = 0, step = null, started_at = now(), lease_until = now() + interval '${LEASE_MINUTES} minutes' where id = $1`,
        [next.id, tokenId],
        tx,
      );
      return {
        id: next.id,
        sourceUrl: next.source_url,
        productName: next.product_name,
        options: parsePhotoOptions(next.options),
      };
    });
  }

  /** How far the worker has got with a job it holds (a percentage and the step it is on). It also keeps the job's lease alive while the work goes on. */
  async progress(tokenId: string, jobId: string, percent: number, step: string | null) {
    const p = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
    const job = await this.db.one<{ id: string }>(
      `update public.photo_jobs set progress = greatest(coalesce(progress, 0), $2), step = $3, lease_until = now() + interval '${LEASE_MINUTES} minutes'
        where id = $1 and status = 'running' and worker_id = $4 returning id`,
      [jobId, p, step ? step.replace(/\s+/g, ' ').trim().slice(0, 80) : null, tokenId],
    );
    if (!job) throw new AppError('This job is not yours any more.', 409);
  }

  /** The improved photo of a job this worker holds. */
  async submit(
    tokenId: string,
    jobId: string,
    rawDetails: unknown,
    image: { buffer: Buffer; mimetype: string },
    cutout: { buffer: Buffer; mimetype: string } | null = null,
  ) {
    if (!IMAGE_TYPES[image.mimetype])
      throw new AppError('The photo must be a WebP, JPEG or PNG image.');
    await checkCutout(cutout);
    const job = await this.db.one<JobRow & { worker_id: string | null }>(
      'select * from public.photo_jobs where id = $1',
      [jobId],
    );
    if (!job) throw notFound('Photo job');
    if (job.status !== 'running' || job.worker_id !== tokenId)
      throw new AppError(
        'This job is not yours any more (it took too long and was given to another worker).',
        409,
      );
    const stored = await this.storage.uploadImage(image.buffer, image.mimetype, 'imports');
    const storedCutout = cutout
      ? await this.storage.uploadImage(cutout.buffer, cutout.mimetype, 'imports')
      : null;
    const done = await this.db.one<{ id: string }>(
      "update public.photo_jobs set status = 'done', result_url = $2, details = $3, error = null, lease_until = null, cutout_url = $5 where id = $1 and status = 'running' and worker_id = $4 returning id",
      [
        jobId,
        stored.url,
        JSON.stringify(parseJobDetails(rawDetails)),
        tokenId,
        storedCutout?.url ?? null,
      ],
    );
    if (!done) {
      await this.storage
        .deleteImages([stored.url, storedCutout?.url].filter((u): u is string => !!u))
        .catch(() => undefined);
      throw new AppError('This job is not yours any more.', 409);
    }
  }

  /** The worker could not do this photo. It is tried again until it has been tried three times. */
  async fail(tokenId: string, jobId: string, message: string) {
    const text =
      message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'The photo could not be improved.';
    const job = await this.db.one<{ id: string }>(
      `update public.photo_jobs set status = case when attempts >= $4 then 'failed' else 'queued' end, error = $2, lease_until = null, worker_id = null, progress = null, step = null, started_at = null
        where id = $1 and status = 'running' and worker_id = $3 returning id`,
      [jobId, text, tokenId, MAX_ATTEMPTS],
    );
    if (!job) throw new AppError('This job is not yours any more.', 409);
  }
}

/** A cut-out must be a PNG or WebP with see-through pixels: anything else is refused, so a white photo is never taken for one. */
export async function checkCutout(cutout: { buffer: Buffer; mimetype: string } | null) {
  if (!cutout) return;
  if (cutout.mimetype !== 'image/png' && cutout.mimetype !== 'image/webp')
    throw new AppError('The cut-out must be a PNG or WebP with a transparent background.');
  if (!(await hasTransparency(cutout.buffer)))
    throw new AppError('The cut-out has no transparent background.');
}
