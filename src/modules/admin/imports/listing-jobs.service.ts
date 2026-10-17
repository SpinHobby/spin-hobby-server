import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { IMAGE_TYPES, StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminLog } from '../admin-log.service.js';
import { ImportsService } from './imports.service.js';
import {
  parseJobDetails,
  parsePhotoOptions,
  type PhotoJobDetails,
  type PhotoJobOptions,
} from './photo-job-options.js';

const LEASE_MINUTES = 60;
const MAX_ATTEMPTS = 3;
const MAX_PHOTOS = 40;
/** A worker that has asked for work in the last five minutes counts as connected. */
const ONLINE_SECONDS = 300;

export type ListingJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
const STATUSES: ListingJobStatus[] = ['queued', 'running', 'done', 'failed', 'cancelled'];

interface JobRow {
  id: string;
  batch_id: string;
  file_name: string;
  options: PhotoJobOptions;
  source_url: string | null;
  status: ListingJobStatus;
  attempts: number;
  worker_id: string | null;
  import_id: string | null;
  details: Partial<PhotoJobDetails>;
  error: string | null;
  created_at: string;
  progress: number | null;
  step: string | null;
  started_at: string | null;
  lease_until: string | null;
  draft_title: string | null;
  draft_status: string | null;
  draft_series: string | null;
  draft_details: Record<string, unknown> | null;
}

const present = (r: JobRow) => ({
  id: r.id,
  batchId: r.batch_id,
  fileName: r.file_name,
  status: r.status,
  draftId: r.import_id,
  draftTitle: r.draft_title,
  draftStatus: r.draft_status,
  flags: r.details.flags ?? [],
  seconds: r.details.seconds ?? null,
  error: r.error,
  progress: r.status === 'running' ? (r.progress ?? 0) : null,
  step: r.status === 'running' ? r.step : null,
  startedAt: r.status === 'running' ? r.started_at : null,
  // when the photo computer last said it was working on this photo (each report renews the lease): a long silence means it may have stopped
  heardAt:
    r.status === 'running' && r.lease_until
      ? new Date(Date.parse(r.lease_until) - LEASE_MINUTES * 60_000).toISOString()
      : null,
  createdAt: r.created_at,
});

/**
 * New listings from photos. An admin uploads photos of products that are not in the shop yet; a Gleamshelf app takes them one at a time (a job is leased to one
 * worker for an hour, and goes back in the queue if the worker disappears), makes a draft listing and sends it back with the finished photo. The draft goes
 * into the Imports inbox like any other, so nothing becomes a product until a person has looked at it and typed the price and stock.
 */
@Injectable()
export class ListingJobsService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly imports: ImportsService,
    private readonly log: AdminLog,
  ) {}

  // ---- the admin sends photos in ----------------------------------------------------------------------------------------------------

  async createBatch(
    adminId: string,
    files: { buffer: Buffer; mimetype: string; originalname?: string }[],
    rawOptions: unknown,
  ) {
    if (!files.length) throw new AppError('Choose at least one photo.');
    if (files.length > MAX_PHOTOS)
      throw new AppError(`Choose at most ${MAX_PHOTOS} photos at a time.`);
    const bad = files.find((f) => !IMAGE_TYPES[f.mimetype]);
    if (bad)
      throw new AppError(
        `${bad.originalname ?? 'A file'} is not a WebP, JPEG or PNG photo. Save it as a JPEG first.`,
      );
    const options = parsePhotoOptions(rawOptions);
    const batchId = randomUUID();
    const stored: string[] = [];
    try {
      for (const f of files) {
        const up = await this.storage.uploadImage(f.buffer, f.mimetype, 'uploads');
        stored.push(up.url);
        await this.db.exec(
          'insert into public.listing_jobs (batch_id, created_by, file_name, options, source_url) values ($1, $2, $3, $4, $5)',
          [batchId, adminId, (f.originalname ?? '').slice(0, 200), JSON.stringify(options), up.url],
        );
      }
    } catch (error) {
      // all or nothing: a half-uploaded set is confusing
      await this.db.exec('delete from public.listing_jobs where batch_id = $1', [batchId]);
      await this.storage.deleteImages(stored).catch(() => undefined);
      throw error;
    }
    await this.log.write(adminId, 'listings.batch_created', batchId, {
      photos: files.length,
      options,
    });
    return { batchId, queued: files.length };
  }

  // ---- what the admin sees ----------------------------------------------------------------------------------------------------------

  async list() {
    const rows = await this.db.many<JobRow>(
      `select j.*, i.title as draft_title, i.status as draft_status, i.series as draft_series, i.details as draft_details
         from public.listing_jobs j left join public.product_imports i on i.id = j.import_id
        order by j.created_at desc, j.file_name limit 120`,
    );
    const counts = await this.db.many<{ status: ListingJobStatus; n: number }>(
      'select status, count(*)::int as n from public.listing_jobs group by status',
    );
    // a finished photo whose draft looks like a product the shop already has: flagged here too, so nobody lists it twice
    const waiting = rows.filter(
      (r) => r.status === 'done' && r.draft_status === 'draft' && r.draft_title,
    );
    const products = waiting.length ? await this.imports.shopProducts() : [];
    const alreadyInShop = new Map(
      waiting.map((r) => [
        r.id,
        this.imports.matchesFor(
          { title: r.draft_title!, series: r.draft_series, details: r.draft_details ?? {} },
          products,
        )[0]?.name ?? null,
      ]),
    );
    return {
      jobs: rows.map((r) => ({ ...present(r), alreadyInShop: alreadyInShop.get(r.id) ?? null })),
      counts: Object.fromEntries(
        STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0]),
      ),
      workers: await this.workers(),
    };
  }

  /** The connected Gleamshelf apps, and whether each has asked for work lately and can write listings. */
  async workers() {
    const rows = await this.db.many<{
      id: string;
      label: string;
      last_used_at: string | null;
      features: string[];
      status_note: string | null;
      running: number;
    }>(
      `select t.id, t.label, t.last_used_at, t.features, t.status_note,
              (select count(*)::int from public.listing_jobs j where j.worker_id = t.id and j.status = 'running') as running
         from public.import_tokens t where t.revoked_at is null order by t.last_used_at desc nulls last`,
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      lastSeen: r.last_used_at,
      online: !!r.last_used_at && now - Date.parse(r.last_used_at) < ONLINE_SECONDS * 1000,
      canCreateListings: r.features.includes('listing'),
      // why it cannot write drafts right now, in its own words (web search down, no vision model)
      note: r.status_note,
      working: r.running,
    }));
  }

  /** Takes a photo that has not started out of the queue. */
  async cancel(adminId: string, jobId: string) {
    const job = await this.db.one<{ source_url: string | null }>(
      "update public.listing_jobs set status = 'cancelled', source_url = null where id = $1 and status = 'queued' returning (select source_url from public.listing_jobs where id = $1) as source_url",
      [jobId],
    );
    if (!job) {
      if (!(await this.db.one('select 1 from public.listing_jobs where id = $1', [jobId])))
        throw notFound('Photo');
      throw new AppError('Only a photo that has not started can be cancelled.', 409);
    }
    if (job.source_url) await this.storage.deleteImages([job.source_url]).catch(() => undefined);
    await this.log.write(adminId, 'listings.job_cancelled', jobId);
  }

  /** Puts a failed photo back in the queue. */
  async retry(adminId: string, jobId: string) {
    const job = await this.db.one<{ id: string }>(
      "update public.listing_jobs set status = 'queued', attempts = 0, error = null, lease_until = null, worker_id = null where id = $1 and status = 'failed' and source_url is not null returning id",
      [jobId],
    );
    if (!job) {
      if (!(await this.db.one('select 1 from public.listing_jobs where id = $1', [jobId])))
        throw notFound('Photo');
      throw new AppError('Only a failed photo can be tried again.', 409);
    }
    await this.log.write(adminId, 'listings.job_retried', jobId);
  }

  // ---- what a worker does -------------------------------------------------------------------------------------------------------------

  /** The next photo to make a listing from, leased to this worker; null when there is none or the worker cannot write listings. */
  async claim(tokenId: string, features: string[], note: string | null = null) {
    await this.db.exec(
      'update public.import_tokens set features = $2, last_used_at = now(), status_note = $3 where id = $1',
      [
        tokenId,
        features.slice(0, 10),
        note ? note.replace(/\s+/g, ' ').trim().slice(0, 200) : null,
      ],
    );
    if (!features.includes('listing')) return null;
    return this.db.transaction(async (tx) => {
      await this.db.exec(
        "update public.listing_jobs set status = 'queued', lease_until = null, worker_id = null, progress = null, step = null, started_at = null where status = 'running' and lease_until < now() and attempts < $1",
        [MAX_ATTEMPTS],
        tx,
      );
      await this.db.exec(
        "update public.listing_jobs set status = 'failed', error = 'The photo computer stopped answering three times.', lease_until = null where status = 'running' and lease_until < now() and attempts >= $1",
        [MAX_ATTEMPTS],
        tx,
      );
      const next = await this.db.one<JobRow>(
        "select * from public.listing_jobs where status = 'queued' and source_url is not null order by created_at, file_name limit 1 for update skip locked",
        [],
        tx,
      );
      if (!next) return null;
      await this.db.exec(
        `update public.listing_jobs set status = 'running', attempts = attempts + 1, worker_id = $2, progress = 0, step = null, started_at = now(), lease_until = now() + interval '${LEASE_MINUTES} minutes' where id = $1`,
        [next.id, tokenId],
        tx,
      );
      return {
        id: next.id,
        sourceUrl: next.source_url!,
        fileName: next.file_name,
        options: parsePhotoOptions(next.options),
      };
    });
  }

  /** How far the worker has got with a job it holds (a percentage and the step it is on). It also keeps the job's lease alive while the work goes on. */
  async progress(tokenId: string, jobId: string, percent: number, step: string | null) {
    const p = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
    const job = await this.db.one<{ id: string }>(
      `update public.listing_jobs set progress = greatest(coalesce(progress, 0), $2), step = $3, lease_until = now() + interval '${LEASE_MINUTES} minutes'
        where id = $1 and status = 'running' and worker_id = $4 returning id`,
      [jobId, p, step ? step.replace(/\s+/g, ' ').trim().slice(0, 80) : null, tokenId],
    );
    if (!job) throw new AppError('This job is not yours any more.', 409);
  }

  /** The draft and finished photo of a job this worker holds: the draft goes into the Imports inbox. */
  async submit(
    tokenId: string,
    jobId: string,
    rawDraft: unknown,
    rawDetails: unknown,
    image: { buffer: Buffer; mimetype: string },
    cutout: { buffer: Buffer; mimetype: string } | null = null,
  ) {
    const job = await this.db.one<JobRow>('select * from public.listing_jobs where id = $1', [
      jobId,
    ]);
    if (!job) throw notFound('Photo');
    if (job.status !== 'running' || job.worker_id !== tokenId)
      throw new AppError(
        'This job is not yours any more (it took too long and was given to another worker).',
        409,
      );
    const draft = await this.imports.receive(tokenId, rawDraft, image, cutout);
    const done = await this.db.one<{ source_url: string | null }>(
      `update public.listing_jobs set status = 'done', import_id = $2, details = $3, error = null, lease_until = null, source_url = null
        where id = $1 and status = 'running' and worker_id = $4 returning $5::text as source_url`,
      [jobId, draft.id, JSON.stringify(parseJobDetails(rawDetails)), tokenId, job.source_url],
    );
    if (!done) throw new AppError('This job is not yours any more.', 409);
    if (job.source_url) await this.storage.deleteImages([job.source_url]).catch(() => undefined);
    return { draftId: draft.id };
  }

  /** The worker could not do this photo. It is tried again until it has been tried three times. */
  async fail(tokenId: string, jobId: string, message: string) {
    const text =
      message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'The listing could not be made.';
    const job = await this.db.one<{ id: string }>(
      `update public.listing_jobs set status = case when attempts >= $4 then 'failed' else 'queued' end, error = $2, lease_until = null, worker_id = null, progress = null, step = null, started_at = null
        where id = $1 and status = 'running' and worker_id = $3 returning id`,
      [jobId, text, tokenId, MAX_ATTEMPTS],
    );
    if (!job) throw new AppError('This job is not yours any more.', 409);
  }
}
