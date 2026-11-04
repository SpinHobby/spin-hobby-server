import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isTest, siteBuildHookUrl, siteRebuildMinHours } from '../../config/app.config.js';
import { Db } from '../../database/db.service.js';

/** How often to look for changes. A rebuild still waits for SITE_REBUILD_MIN_HOURS since the last one. */
const CHECK_MINUTES = 30;

/**
 * Keeps the website's search-engine pages current. The sitemap, the Google Shopping feed and the page per product are written
 * when the website is built, so a product added in Square doesn't reach Google until the next build. This asks Netlify for one
 * (its build hook, SITE_BUILD_HOOK_URL) when what shoppers can see has changed: a product added, removed, renamed, repriced,
 * re-photographed or changing between in stock, sold out and pre-order. At most once every SITE_REBUILD_MIN_HOURS. Off without
 * the hook.
 */
@Injectable()
export class SiteRebuildService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SiteRebuildService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Db) {}

  onModuleInit() {
    if (!siteBuildHookUrl() || isTest()) return;
    this.timer = setInterval(
      () => void this.check().catch(() => undefined),
      CHECK_MINUTES * 60_000,
    );
    this.timer.unref();
    this.logger.log(
      `Website rebuilds: checking every ${CHECK_MINUTES} min, at most every ${siteRebuildMinHours()} h.`,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** A short summary of every product shoppers can see; it changes when any of them changes in a way the website shows. */
  async fingerprint() {
    const row = await this.db.one<{ fingerprint: string }>(
      `select md5(coalesce(string_agg(concat_ws('|', id, name, price_cents, status, images[1]), ',' order by id), '')) as fingerprint
         from public.storefront_products`,
    );
    return row?.fingerprint ?? '';
  }

  /** Asks Netlify for a rebuild if the products changed since the last one asked for and it has been long enough. */
  async check(now = new Date()): Promise<'off' | 'unchanged' | 'waiting' | 'requested' | 'failed'> {
    const hook = siteBuildHookUrl();
    if (!hook) return 'off';
    const fingerprint = await this.fingerprint();
    const last = await this.db.one<{ fingerprint: string | null; requested_at: string | null }>(
      'select fingerprint, requested_at from public.site_rebuild where id',
    );
    if (last?.fingerprint === fingerprint) return 'unchanged';
    const wait = siteRebuildMinHours() * 3_600_000;
    if (last?.requested_at && now.getTime() - new Date(last.requested_at).getTime() < wait)
      return 'waiting';
    const res = await fetch(hook, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) {
      this.logger.warn(`Website rebuild request failed: ${res ? res.status : 'no answer'}`);
      return 'failed';
    }
    await this.db.exec(
      `insert into public.site_rebuild (id, fingerprint, requested_at) values (true, $1, $2)
       on conflict (id) do update set fingerprint = excluded.fingerprint, requested_at = excluded.requested_at`,
      [fingerprint, now.toISOString()],
    );
    this.logger.log(
      'Asked Netlify to rebuild the website: the products shoppers see have changed.',
    );
    return 'requested';
  }
}
