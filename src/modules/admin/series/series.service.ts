import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { seriesKey } from '../../../common/series-key.js';
import { Db, type Queryable } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';

export interface SeriesRow {
  id: string;
  name: string;
  aliases: string[];
}

/** The list of anime / franchises products can belong to. A product's series is optional. */
@Injectable()
export class SeriesService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** Every series with how many products use it, A to Z. */
  async list() {
    const rows = await this.db.many<SeriesRow & { products: number }>(
      `select s.id, s.name, s.aliases,
              (select count(*)::int from public.product_metadata m where m.series_id = s.id) as products
         from public.series s order by lower(s.name)`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases,
      productCount: r.products,
    }));
  }

  /** The existing series this name means (matching spelling, spacing and aliases), or null. */
  async find(name: string, queryable?: Queryable): Promise<SeriesRow | null> {
    const key = seriesKey(name);
    if (!key) return null;
    const all = await this.db.many<SeriesRow>(
      'select id, name, aliases from public.series',
      [],
      queryable,
    );
    return (
      all.find((s) => seriesKey(s.name) === key || s.aliases.some((a) => seriesKey(a) === key)) ??
      null
    );
  }

  /**
   * The series for a typed name: the existing one when it matches (so "re zero" becomes "Re:Zero"), otherwise a
   * new one. A blank name means no series.
   */
  async resolve(
    name: string | null | undefined,
    queryable?: Queryable,
  ): Promise<{ id: string; name: string; created: boolean } | null> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return null;
    if (trimmed.length > 120)
      throw new AppError('The series name is too long (120 characters at most).');
    const existing = await this.find(trimmed, queryable);
    if (existing) return { id: existing.id, name: existing.name, created: false };
    const created = await this.db.one<{ id: string; name: string }>(
      `insert into public.series (name) values ($1)
       on conflict (lower(btrim(name))) do update set name = public.series.name
       returning id, name`,
      [trimmed],
      queryable,
    );
    return { id: created!.id, name: created!.name, created: true };
  }

  async create(adminId: string, name: string, aliases: string[]) {
    const series = await this.resolve(name);
    if (!series) throw new AppError('Enter a series name.');
    if (aliases.length)
      await this.db.exec(
        `update public.series set aliases = (select array(select distinct unnest(aliases || $2::text[]))) where id = $1`,
        [series.id, aliases],
      );
    if (series.created)
      await this.log.write(adminId, 'series.created', series.id, { name: series.name });
    return series;
  }

  /** Renames a series and/or replaces its alternate names; the products using it follow the new name. */
  async update(adminId: string, id: string, change: { name?: string; aliases?: string[] }) {
    const current = await this.db.one<SeriesRow>(
      'select id, name, aliases from public.series where id = $1',
      [id],
    );
    if (!current) throw notFound('Series');
    const name = change.name?.trim();
    if (name !== undefined) {
      if (!name) throw new AppError('Enter a series name.');
      const clash = await this.find(name);
      if (clash && clash.id !== id)
        throw new AppError(`"${clash.name}" is already in the list.`, 409);
    }
    await this.db.transaction(async (tx) => {
      await this.db.exec(
        'update public.series set name = coalesce($2, name), aliases = coalesce($3::text[], aliases) where id = $1',
        [id, name ?? null, change.aliases ?? null],
        tx,
      );
      if (name !== undefined)
        await this.db.exec(
          'update public.product_metadata set series = $2 where series_id = $1',
          [id, name],
          tx,
        );
      await this.log.write(adminId, 'series.updated', id, change, tx);
    });
  }
}
