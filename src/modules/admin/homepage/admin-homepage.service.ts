import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import type { HeroSlideRow } from '../../../database/rows.js';
import { AdminLog } from '../admin-log.service.js';
import { sentFields } from '../dto/defined-fields.js';
import { MAX_ADS } from './banner.js';
import type { CreateSlideDto, UpdateSlideDto } from './dto/slide.dto.js';

// The API speaks camelCase (imageUrl); the table uses snake_case.
const COLUMN: Record<string, string> = {
  headline: 'headline',
  subheading: 'subheading',
  imageUrl: 'image_url',
  linkUrl: 'link_url',
  label: 'label',
  buttonText: 'button_text',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  backdrop: 'backdrop',
  productIds: 'product_ids',
  isVisible: 'is_visible',
  sortOrder: 'sort_order',
};

function datesInOrder(startsAt: string | Date | null, endsAt: string | Date | null) {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))
    throw new AppError('An ad must end after it starts.');
}

/** The homepage banner ads ("slides"): up to MAX_ADS, each with its own words, dates and pictures behind. */
@Injectable()
export class AdminHomepageService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  list() {
    return this.db.many<HeroSlideRow>(
      'select * from public.hero_slides order by sort_order, created_at',
    );
  }

  async create(adminId: string, dto: CreateSlideDto) {
    const { count } = (await this.db.one<{ count: number }>(
      'select count(*)::int as count from public.hero_slides',
    ))!;
    if (count >= MAX_ADS)
      throw new AppError(`The banner holds at most ${MAX_ADS} ads. Remove one first.`);
    datesInOrder(dto.startsAt, dto.endsAt);
    const slide = await this.db.one<HeroSlideRow>(
      `insert into public.hero_slides
         (headline, subheading, image_url, link_url, is_visible, sort_order, label, button_text, starts_at, ends_at, backdrop, product_ids)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
      [
        dto.headline,
        dto.subheading,
        dto.imageUrl,
        dto.linkUrl,
        dto.isVisible,
        dto.sortOrder,
        dto.label,
        dto.buttonText,
        dto.startsAt,
        dto.endsAt,
        dto.backdrop,
        dto.productIds,
      ],
    );
    await this.log.write(adminId, 'homepage.slide_created', slide!.id);
    return slide;
  }

  /** Updates only the fields that were sent. With nothing to change, returns the slide as it is. */
  async update(adminId: string, id: string, dto: UpdateSlideDto) {
    const changes = Object.fromEntries(
      Object.entries(sentFields(dto)).map(([key, value]) => [COLUMN[key], value]),
    );
    const columns = Object.keys(changes);
    if ('starts_at' in changes || 'ends_at' in changes) {
      const now = await this.db.one<HeroSlideRow>(
        'select * from public.hero_slides where id = $1',
        [id],
      );
      if (!now) throw notFound('Slide');
      datesInOrder(
        'starts_at' in changes ? (changes.starts_at as string | null) : now.starts_at,
        'ends_at' in changes ? (changes.ends_at as string | null) : now.ends_at,
      );
    }
    const slide = columns.length
      ? await this.db.one<HeroSlideRow>(
          `update public.hero_slides set ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1 returning *`,
          [id, ...columns.map((c) => changes[c])],
        )
      : await this.db.one<HeroSlideRow>('select * from public.hero_slides where id = $1', [id]);
    if (!slide) throw notFound('Slide');
    await this.log.write(adminId, 'homepage.slide_updated', id, changes);
    return slide;
  }

  /** Saves a new order: the first id becomes position 0, and so on. */
  async reorder(adminId: string, ids: string[]) {
    await this.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await this.db.exec(
          'update public.hero_slides set sort_order = $2 where id::text = $1',
          [id, position],
          tx,
        );
      }
      await this.log.write(adminId, 'homepage.slides_reordered', 'hero_slides', {}, tx);
    });
  }

  async remove(adminId: string, id: string) {
    await this.db.exec('delete from public.hero_slides where id = $1', [id]);
    await this.log.write(adminId, 'homepage.slide_deleted', id);
  }
}
