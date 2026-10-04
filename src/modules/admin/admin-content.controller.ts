import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AdminLog } from './admin-log.service.js';
import { AppError, notFound } from '../../common/errors.js';
import {
  jsonBody,
  optionalString,
  stringValue,
  boolValue,
  type Json,
} from '../../common/validation/rules.js';
import { env } from '../../config/env.js';
import { Db, type Row } from '../../database/db.service.js';
import { SquareSyncService } from '../square-sync/square-sync.service.js';
import { StoreService } from '../store/store.service.js';

const SETTINGS_FIELDS = [
  'payment_provider',
  'shipping_standard_cents',
  'shipping_express_cents',
  'free_shipping_threshold_cents',
  'low_stock_threshold',
  'fx_cad_usd',
  'handling_days_min',
  'handling_days_max',
  'maintenance_mode',
  'maintenance_message',
] as const;
const SETTINGS_INTEGERS = [
  'shipping_standard_cents',
  'shipping_express_cents',
  'free_shipping_threshold_cents',
  'low_stock_threshold',
  'handling_days_min',
  'handling_days_max',
];

function sortOrder(value: unknown) {
  return Number.isInteger(Number(value)) ? Number(value) : 0;
}

@Controller('admin')
@Access('staff')
export class AdminContentController {
  constructor(
    private readonly db: Db,
    private readonly store: StoreService,
    private readonly log: AdminLog,
    private readonly sync: SquareSyncService,
  ) {}

  // ---------------------------------------------------------------- settings
  @Get('settings')
  async settings() {
    return { success: true, settings: await this.store.settings() };
  }

  @Put('settings')
  @Access('owner')
  async updateSettings(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const payload = jsonBody(body);
    const update: Row = {};
    for (const key of SETTINGS_FIELDS) if (key in payload) update[key] = payload[key];
    if (update.payment_provider && !['paypal', 'square'].includes(update.payment_provider))
      throw new AppError('Invalid payment provider.');
    if (update.maintenance_mode !== undefined)
      update.maintenance_mode = boolValue(update.maintenance_mode, 'maintenance_mode');
    if (update.maintenance_message !== undefined)
      update.maintenance_message = optionalString(update.maintenance_message, 1000);
    for (const key of SETTINGS_INTEGERS) {
      if (
        update[key] !== undefined &&
        (!Number.isInteger(Number(update[key])) || Number(update[key]) < 0)
      )
        throw new AppError(`Invalid ${key}.`);
    }
    if (update.fx_cad_usd !== undefined && !(Number(update.fx_cad_usd) > 0))
      throw new AppError('Invalid fx_cad_usd.');
    const keys = Object.keys(update);
    if (!keys.length) return { success: true, settings: await this.store.settings() };
    const current = await this.store.settings();
    const min = Number(update.handling_days_min ?? current.handling_days_min);
    const max = Number(update.handling_days_max ?? current.handling_days_max);
    if (max < min) throw new AppError('Handling max must be at least the min.');
    const settings = await this.db.transaction(async (tx) => {
      const row = await this.db.one(
        `update public.store_settings set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id = true returning *`,
        keys.map((k) => update[k]),
        tx,
      );
      await this.log.write(admin.id, 'settings.updated', 'store', update, tx);
      return row;
    });
    return { success: true, settings };
  }

  // ---------------------------------------------------------------- tax rates (owner)
  @Get('tax-rates')
  @Access('owner')
  async taxRates() {
    return {
      success: true,
      taxRates: await this.db.many('select * from public.tax_rates order by country, province'),
    };
  }

  @Put('tax-rates')
  @Access('owner')
  async updateTaxRate(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const payload = jsonBody(body);
    const country = payload.country === 'CA' || payload.country === 'US' ? payload.country : null;
    const province = stringValue(payload.province, 'province', 10).toUpperCase();
    const rate = Number(payload.rate);
    if (!country || !Number.isFinite(rate) || rate < 0 || rate > 1)
      throw new AppError('Invalid tax rate.');
    const enabled = payload.enabled !== false;
    const taxRate = await this.db.one(
      `insert into public.tax_rates (country, province, rate, enabled) values ($1, $2, $3, $4)
       on conflict (country, province) do update set rate = excluded.rate, enabled = excluded.enabled returning *`,
      [country, province, rate, enabled],
    );
    await this.log.write(admin.id, 'tax_rate.updated', `${country}/${province}`, { rate, enabled });
    return { success: true, taxRate };
  }

  // ---------------------------------------------------------------- hero slides
  @Get('homepage/slides')
  async slides() {
    return {
      success: true,
      slides: await this.db.many(
        'select * from public.hero_slides order by sort_order, created_at',
      ),
    };
  }

  @Post('homepage/slides')
  @HttpCode(200)
  async createSlide(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const p = jsonBody(body);
    const slide = await this.db.one(
      `insert into public.hero_slides (headline, subheading, image_url, link_url, is_visible, sort_order)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [
        stringValue(p.headline, 'headline', 160),
        optionalString(p.subheading, 300),
        optionalString(p.imageUrl, 1000),
        optionalString(p.linkUrl, 1000),
        p.isVisible === true,
        sortOrder(p.sortOrder),
      ],
    );
    await this.log.write(admin.id, 'homepage.slide_created', slide!.id);
    return { success: true, slide };
  }

  // PUT is what the admin sends; POST kept for callers of the original edge route.
  @Put('homepage/slides/reorder')
  @HttpCode(200)
  reorderPut(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    return this.reorder(admin, body);
  }

  @Post('homepage/slides/reorder')
  @HttpCode(200)
  reorderPost(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    return this.reorder(admin, body);
  }

  private async reorder(admin: AppUser, body: unknown) {
    const ids = jsonBody(body).ids;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string'))
      throw new AppError('ids is required.');
    await this.db.transaction(async (tx) => {
      for (const [i, id] of (ids as string[]).entries())
        await this.db.exec(
          'update public.hero_slides set sort_order = $2 where id::text = $1',
          [id, i],
          tx,
        );
      await this.log.write(admin.id, 'homepage.slides_reordered', 'hero_slides', {}, tx);
    });
    return { success: true };
  }

  @Put('homepage/slides/:id')
  async updateSlide(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const p = jsonBody(body);
    const update: Row = {};
    if ('headline' in p) update.headline = stringValue(p.headline, 'headline', 160);
    if ('subheading' in p) update.subheading = optionalString(p.subheading, 300);
    if ('imageUrl' in p) update.image_url = optionalString(p.imageUrl, 1000);
    if ('linkUrl' in p) update.link_url = optionalString(p.linkUrl, 1000);
    if ('isVisible' in p) update.is_visible = p.isVisible === true;
    if ('sortOrder' in p && Number.isInteger(Number(p.sortOrder)))
      update.sort_order = Number(p.sortOrder);
    const keys = Object.keys(update);
    const slide = keys.length
      ? await this.db.one(
          `update public.hero_slides set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`,
          [id, ...keys.map((k) => update[k])],
        )
      : await this.db.one('select * from public.hero_slides where id = $1', [id]);
    if (!slide) throw notFound('Slide');
    await this.log.write(admin.id, 'homepage.slide_updated', id, update);
    return { success: true, slide };
  }

  @Delete('homepage/slides/:id')
  async deleteSlide(@CurrentUser() admin: AppUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.exec('delete from public.hero_slides where id = $1', [id]);
    await this.log.write(admin.id, 'homepage.slide_deleted', id);
    return { success: true };
  }

  // ---------------------------------------------------------------- events
  @Get('events')
  async events() {
    return {
      success: true,
      events: await this.db.many(
        'select * from public.store_events order by sort_order, created_at',
      ),
    };
  }

  private eventRecord(p: Json) {
    const start = optionalString(p.startDate, 30);
    const end = optionalString(p.endDate, 30);
    for (const d of [start, end])
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new AppError('Dates must be YYYY-MM-DD.');
    if (start && end && end < start)
      throw new AppError('End date must be on or after the start date.');
    return [
      stringValue(p.name, 'name', 160),
      optionalString(p.city, 120),
      optionalString(p.startDate, 30),
      optionalString(p.endDate, 30),
      optionalString(p.boothInfo, 200),
      p.isVisible !== false,
      sortOrder(p.sortOrder),
    ];
  }

  @Post('events')
  @HttpCode(200)
  async createEvent(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const record = this.eventRecord(jsonBody(body));
    const event = await this.db.one(
      `insert into public.store_events (name, city, start_date, end_date, booth_info, is_visible, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      record,
    );
    await this.log.write(admin.id, 'event.created', event!.id, { name: record[0] });
    return { success: true, event };
  }

  @Put('events/:id')
  async updateEvent(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const record = this.eventRecord(jsonBody(body));
    const event = await this.db.one(
      `update public.store_events set name = $2, city = $3, start_date = $4, end_date = $5, booth_info = $6, is_visible = $7, sort_order = $8
        where id = $1 returning *`,
      [id, ...record],
    );
    if (!event) throw notFound('Event');
    await this.log.write(admin.id, 'event.updated', id, { name: record[0] });
    return { success: true, event };
  }

  @Delete('events/:id')
  async deleteEvent(@CurrentUser() admin: AppUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.exec('delete from public.store_events where id = $1', [id]);
    await this.log.write(admin.id, 'event.deleted', id);
    return { success: true };
  }

  // ---------------------------------------------------------------- Square
  @Get('square/readiness')
  async readiness() {
    const [catalog, settings] = await Promise.all([
      // Only items that came from Square count: sample and hand-entered products carry a timestamp too, but nothing was synced.
      this.db.one<{ synced_at: string | null }>(
        "select max(synced_at) as synced_at from public.catalog_products where source = 'square'",
      ),
      this.store.settings(),
    ]);
    return {
      success: true,
      readiness: {
        appAndLocationConnected: Boolean(env('SQUARE_ACCESS_TOKEN') && env('SQUARE_LOCATION_ID')),
        catalogAndInventorySyncing: Boolean(catalog?.synced_at),
        webhookKeySet: Boolean(env('SQUARE_WEBHOOK_SIGNATURE_KEY') && env('SQUARE_WEBHOOK_URL')),
        sandboxPaymentsConfigured: (env('SQUARE_ENV') ?? env('SQUARE_ENVIRONMENT')) === 'sandbox',
        threeDSecureEnabled: false,
        applePayDomainVerified: false,
        activeProvider: settings.payment_provider,
        lastSyncAt: catalog?.synced_at ?? null,
      },
    };
  }

  /** Runs the catalog + inventory sync in-process (no separate function to call). */
  @Post('square/sync')
  @HttpCode(200)
  @Access('owner')
  async runSync(@CurrentUser() admin: AppUser) {
    const result = await this.sync.run();
    await this.log.write(admin.id, 'square.sync_completed', 'catalog', { ...result });
    return { success: true, sync: result };
  }
}
