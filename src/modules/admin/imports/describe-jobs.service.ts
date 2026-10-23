import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { SquareCatalogClient } from '../../../integrations/square/square-catalog.client.js';
import { AdminLog } from '../admin-log.service.js';
import { AdminProductsService } from '../products/admin-products.service.js';
import { JOBS_WITH_PRODUCT } from './describe-jobs.sql.js';
import { ListingJobsService } from './listing-jobs.service.js';

const LEASE_MINUTES = 30;
const MAX_ATTEMPTS = 3;
/** A description shorter than this is treated as none (a stray word or a code). */
export const MIN_DESCRIPTION = 40;

export type DescribeJobStatus =
  'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'applied' | 'dismissed';
const STATUSES: DescribeJobStatus[] = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'applied',
  'dismissed',
];

/** The proposal as the shop keeps it: cleaned, short, plain text. */
export interface DescribeProposal {
  description: string;
  series: string | null;
  manufacturer: string | null;
  category: string | null;
  highlights: string[];
  unsupported: string[];
  flags: string[];
  sources: string[];
  lookup: string | null;
  seconds: number | null;
}

const text = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/[^\S\n]+/g, ' ')
        .trim()
        .slice(0, max) || null
    : null;
const list = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => text(x, max))
    .filter((x): x is string => !!x)
    .slice(0, n);

export function parseProposal(raw: Record<string, unknown>): DescribeProposal {
  const description = text(raw.description, 4000)?.replace(/\n{3,}/g, '\n\n') ?? null;
  if (!description) throw new AppError('The proposal has no description.');
  const lookup =
    raw.lookup && typeof raw.lookup === 'object'
      ? text((raw.lookup as Record<string, unknown>).detail, 300)
      : text(raw.lookup, 300);
  const seconds = Number(raw.seconds);
  return {
    description,
    series: text(raw.series, 120),
    manufacturer: text(raw.manufacturer, 120),
    category: text(raw.category, 120),
    highlights: list(raw.highlights, 10, 200),
    unsupported: list(raw.unsupported, 10, 200),
    flags: list(raw.flags, 10, 300),
    sources: list(raw.sources, 10, 500).filter((u) => /^https?:\/\//i.test(u)),
    lookup,
    seconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null,
  };
}

interface JobRow {
  id: string;
  batch_id: string;
  square_item_id: string;
  product_name: string;
  photo_url: string | null;
  status: DescribeJobStatus;
  attempts: number;
  worker_id: string | null;
  progress: number | null;
  step: string | null;
  started_at: string | null;
  result: Partial<DescribeProposal>;
  error: string | null;
  created_at: string;
  updated_at: string;
  // the product as it is now
  current_description: string | null;
  current_series: string | null;
  current_manufacturer: string | null;
  category: string | null;
  character: string | null;
}

/**
 * Descriptions for products the shop already has. Products picked in the admin become jobs; a Gleamshelf app takes them one at a time (leased for half an hour,
 * back in the queue if the app disappears), reads the photo, looks the product up and proposes a description, series and maker. A person applies or skips each
 * proposal: applying writes the description to Square (a hand-entered product keeps it here) and the series and maker to the product.
 */
@Injectable()
export class DescribeJobsService {
  constructor(
    private readonly db: Db,
    private readonly square: SquareCatalogClient,
    private readonly products: AdminProductsService,
    private readonly listings: ListingJobsService,
    private readonly log: AdminLog,
  ) {}

  /** Visible products with no real description yet: what "describe them all" would send. */
  async missingCount() {
    const row = await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.storefront_products where coalesce(length(trim(description)), 0) < ${MIN_DESCRIPTION}`,
    );
    return row?.n ?? 0;
  }

  // ---- the admin sends products in -----------------------------------------------------------------------------------------------------

  async createBatch(
    adminId: string,
    choice: { ids: string[] | null; missing: boolean; limit: number },
  ) {
    if (!choice.ids?.length && !choice.missing)
      throw new AppError('Choose products, or every product without a description.');
    const rows = await this.db.many<{
      id: string;
      name: string;
      photo: string | null;
      open: boolean;
    }>(
      `select sp.id, sp.name, sp.images[1] as photo,
              exists (select 1 from public.describe_jobs j where j.square_item_id = sp.id and j.status in ('queued', 'running', 'done')) as open
         from public.storefront_products sp
        where ${choice.ids?.length ? 'sp.id = any($1::text[])' : `coalesce(length(trim(sp.description)), 0) < ${MIN_DESCRIPTION} and $1::text[] is null`}
        order by sp.rank asc nulls last, sp.created_at desc
        limit ${choice.limit}`,
      [choice.ids?.length ? choice.ids : null],
    );
    const batchId = randomUUID();
    const ready = rows.filter((r) => r.photo && !r.open);
    for (const r of ready)
      await this.db.exec(
        `insert into public.describe_jobs (batch_id, created_by, square_item_id, product_name, photo_url) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [batchId, adminId, r.id, r.name.slice(0, 300), r.photo],
      );
    const result = {
      batchId,
      queued: ready.length,
      noPhoto: rows.filter((r) => !r.photo).length,
      alreadyQueued: rows.filter((r) => r.open).length,
    };
    if (ready.length) await this.log.write(adminId, 'describe.batch_created', batchId, result);
    return result;
  }

  // ---- what the admin sees -------------------------------------------------------------------------------------------------------------

  async list(status: 'open' | 'done' | 'finished' = 'open') {
    const where =
      status === 'done'
        ? "j.status = 'done'"
        : status === 'finished'
          ? "j.status in ('applied', 'dismissed')"
          : "j.status in ('queued', 'running', 'done', 'failed')";
    const rows = await this.db.many<JobRow>(
      `${JOBS_WITH_PRODUCT}
        where ${where}
        order by case j.status when 'done' then 0 when 'running' then 1 when 'failed' then 2 else 3 end, j.created_at, j.product_name
        limit 200`,
    );
    const counts = await this.db.many<{ status: DescribeJobStatus; n: number }>(
      'select status, count(*)::int as n from public.describe_jobs group by status',
    );
    const workers = await this.listings.workers();
    return {
      jobs: rows.map((r) => ({
        id: r.id,
        productId: r.square_item_id,
        productName: r.product_name,
        photoUrl: r.photo_url,
        status: r.status,
        progress: r.status === 'running' ? (r.progress ?? 0) : null,
        step: r.status === 'running' ? r.step : null,
        startedAt: r.status === 'running' ? r.started_at : null,
        error: r.error,
        proposal:
          r.status === 'queued' || r.status === 'running' ? null : (r.result as DescribeProposal),
        current: {
          description: r.current_description,
          series: r.current_series,
          manufacturer: r.current_manufacturer,
          category: r.category,
        },
        createdAt: r.created_at,
      })),
      counts: Object.fromEntries(
        STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0]),
      ),
      missing: await this.missingCount(),
      // a photo computer can describe products when it has the vision model and web search (it says "describe")
      workers: workers.map((w) => ({ ...w, canDescribe: w.online && w.canCreateListings })),
    };
  }

  /** Writes a proposal (as a person left it) to the product, and marks it applied. */
  async apply(
    adminId: string,
    jobId: string,
    edits: { description: string; series?: string | null; manufacturer?: string | null },
  ) {
    const job = await this.db.one<{
      status: DescribeJobStatus;
      square_item_id: string;
      source: string;
    }>(
      `select j.status, j.square_item_id, p.source from public.describe_jobs j join public.catalog_products p on p.square_item_id = j.square_item_id where j.id = $1`,
      [jobId],
    );
    if (!job) throw notFound('Proposal');
    if (job.status !== 'done') throw new AppError('Only a finished proposal can be applied.', 409);
    const description = edits.description.replace(/\r\n/g, '\n').trim();
    if (description.length < 20) throw new AppError('Write a description of at least a sentence.');
    // Square first: if it refuses, nothing here changes and the proposal stays ready to apply
    if (job.source === 'square')
      await this.square.setItemDescription(job.square_item_id, description);
    await this.db.exec(
      'update public.catalog_products set description = $2 where square_item_id = $1',
      [job.square_item_id, description],
    );
    const details: Record<string, string | null> = {};
    if (edits.series !== undefined) details.series = edits.series;
    if (edits.manufacturer !== undefined) details.manufacturer = edits.manufacturer;
    if (Object.keys(details).length)
      await this.products.updateDetails(adminId, job.square_item_id, details);
    await this.db.exec(
      "update public.describe_jobs set status = 'applied', reviewed_by = $2, reviewed_at = now() where id = $1",
      [jobId, adminId],
    );
    await this.log.write(adminId, 'describe.applied', job.square_item_id, { jobId, ...details });
  }

  /** Skips a proposal: the product stays as it was. */
  async dismiss(adminId: string, jobId: string) {
    const job = await this.db.one<{ id: string }>(
      "update public.describe_jobs set status = 'dismissed', reviewed_by = $2, reviewed_at = now() where id = $1 and status = 'done' returning id",
      [jobId, adminId],
    );
    if (!job) await this.explain(jobId, 'Only a finished proposal can be skipped.');
    await this.log.write(adminId, 'describe.dismissed', jobId);
  }

  /** Takes a product that has not started out of the queue. */
  async cancel(adminId: string, jobId: string) {
    const job = await this.db.one<{ id: string }>(
      "update public.describe_jobs set status = 'cancelled' where id = $1 and status = 'queued' returning id",
      [jobId],
    );
    if (!job)
      await this.explain(
        jobId,
        'Only a product that has not started can be taken out of the queue.',
      );
  }

  /** Every product still waiting in the queue comes out of it. */
  async cancelQueued(adminId: string) {
    const rows = await this.db.many<{ id: string }>(
      "update public.describe_jobs set status = 'cancelled' where status = 'queued' returning id",
    );
    if (rows.length)
      await this.log.write(adminId, 'describe.queue_cleared', 'queue', { cancelled: rows.length });
    return { cancelled: rows.length };
  }

  /** Asks again for a failed or skipped product. */
  async retry(adminId: string, jobId: string) {
    const job = await this.db.one<{ id: string }>(
      `update public.describe_jobs set status = 'queued', attempts = 0, error = null, lease_until = null, worker_id = null, result = '{}'::jsonb
        where id = $1 and status in ('failed', 'dismissed')
          and not exists (select 1 from public.describe_jobs o where o.square_item_id = describe_jobs.square_item_id and o.id <> $1 and o.status in ('queued', 'running', 'done'))
        returning id`,
      [jobId],
    );
    if (!job) await this.explain(jobId, 'Only a failed or skipped product can be asked again.');
    await this.log.write(adminId, 'describe.retried', jobId);
  }

  private async explain(jobId: string, message: string): Promise<never> {
    if (!(await this.db.one('select 1 from public.describe_jobs where id = $1', [jobId])))
      throw notFound('Proposal');
    throw new AppError(message, 409);
  }

  // ---- what a worker does --------------------------------------------------------------------------------------------------------------

  /** The next product to describe, leased to this worker; null when there is none or the worker cannot describe products. */
  async claim(tokenId: string, features: string[]) {
    await this.db.exec('update public.import_tokens set last_used_at = now() where id = $1', [
      tokenId,
    ]);
    if (!features.includes('describe')) return null;
    return this.db.transaction(async (tx) => {
      await this.db.exec(
        "update public.describe_jobs set status = 'queued', lease_until = null, worker_id = null, progress = null, step = null, started_at = null where status = 'running' and lease_until < now() and attempts < $1",
        [MAX_ATTEMPTS],
        tx,
      );
      await this.db.exec(
        "update public.describe_jobs set status = 'failed', error = 'The photo computer stopped answering three times.', lease_until = null where status = 'running' and lease_until < now() and attempts >= $1",
        [MAX_ATTEMPTS],
        tx,
      );
      const next = await this.db.one<JobRow>(
        `${JOBS_WITH_PRODUCT}
          where j.status = 'queued' and j.photo_url is not null
          order by j.created_at, j.product_name limit 1 for update of j skip locked`,
        [],
        tx,
      );
      if (!next) return null;
      await this.db.exec(
        `update public.describe_jobs set status = 'running', attempts = attempts + 1, worker_id = $2, progress = 0, step = null, started_at = now(), lease_until = now() + interval '${LEASE_MINUTES} minutes' where id = $1`,
        [next.id, tokenId],
        tx,
      );
      return {
        id: next.id,
        productId: next.square_item_id,
        productName: next.product_name,
        photoUrl: next.photo_url!,
        // what the shop already knows: the name is the best search words; a person typed the rest
        hints: {
          category: next.category,
          series: next.current_series,
          character: next.character,
          manufacturer: next.current_manufacturer,
        },
      };
    });
  }

  async progress(tokenId: string, jobId: string, percent: number, step: string | null) {
    const p = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
    const job = await this.db.one<{ id: string }>(
      `update public.describe_jobs set progress = greatest(coalesce(progress, 0), $2), step = $3, lease_until = now() + interval '${LEASE_MINUTES} minutes'
        where id = $1 and status = 'running' and worker_id = $4 returning id`,
      [jobId, p, step ? step.replace(/\s+/g, ' ').trim().slice(0, 80) : null, tokenId],
    );
    if (!job) throw new AppError('This job is not yours any more.', 409);
  }

  async submit(tokenId: string, jobId: string, raw: Record<string, unknown>) {
    const proposal = parseProposal(raw);
    const job = await this.db.one<{ id: string }>(
      `update public.describe_jobs set status = 'done', result = $2, error = null, lease_until = null, progress = null, step = null
        where id = $1 and status = 'running' and worker_id = $3 returning id`,
      [jobId, JSON.stringify(proposal), tokenId],
    );
    if (!job) {
      if (!(await this.db.one('select 1 from public.describe_jobs where id = $1', [jobId])))
        throw notFound('Job');
      throw new AppError(
        'This job is not yours any more (it took too long and was given to another worker).',
        409,
      );
    }
  }

  async fail(tokenId: string, jobId: string, message: string) {
    const textMessage =
      message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'The description could not be written.';
    const job = await this.db.one<{ id: string }>(
      `update public.describe_jobs set status = case when attempts >= $4 then 'failed' else 'queued' end, error = $2, lease_until = null, worker_id = null, progress = null, step = null, started_at = null
        where id = $1 and status = 'running' and worker_id = $3 returning id`,
      [jobId, textMessage, tokenId, MAX_ATTEMPTS],
    );
    if (!job) throw new AppError('This job is not yours any more.', 409);
  }
}
