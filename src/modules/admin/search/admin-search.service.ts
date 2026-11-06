import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { foldSearch, synonymsChanged } from '../../catalog/search.js';
import type { SynonymGroupDto } from './dto/synonym-group.dto.js';
import { Db } from '../../../database/db.service.js';
import type { SearchMissRow, SearchSynonymRow } from '../../../database/rows.js';
import { AdminLog } from '../admin-log.service.js';

/** How many missed searches the Dashboard lists. */
const MISSES_SHOWN = 30;

@Injectable()
export class AdminSearchService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** The searches that found nothing in the last `days` days, most frequent first. */
  async misses(days: number) {
    const rows = await this.db.many<SearchMissRow>(
      `select query, times, first_at, last_at from public.search_misses
        where last_at > now() - make_interval(days => $1) order by times desc, last_at desc limit ${MISSES_SHOWN}`,
      [days],
    );
    return rows.map((r) => ({
      query: r.query,
      times: r.times,
      firstAt: r.first_at,
      lastAt: r.last_at,
    }));
  }

  /** Takes a search off the list once it's handled (stocked, or a synonym added); it comes back if shoppers miss it again. */
  async dismiss(adminId: string, query: string) {
    const gone = await this.db.one<{ times: number }>(
      'delete from public.search_misses where query = $1 returning times',
      [query],
    );
    if (!gone) throw notFound('Search');
    await this.log.write(adminId, 'search_miss.dismissed', query, { times: gone.times });
  }

  /** Every synonym group, by kind, then alphabetically by its first name. */
  async synonyms() {
    const rows = await this.db.many<SearchSynonymRow>(
      `select id, kind, terms, created_at, updated_at from public.search_synonyms
        order by array_position(array['type', 'series', 'maker', 'other'], kind), lower(terms[1])`,
    );
    return rows.map(publicGroup);
  }

  async addSynonyms(adminId: string, dto: SynonymGroupDto) {
    await this.refuseOverlap(dto.terms, null);
    const row = await this.db.one<SearchSynonymRow>(
      'insert into public.search_synonyms (kind, terms) values ($1, $2) returning *',
      [dto.kind, dto.terms],
    );
    await this.log.write(adminId, 'search_synonyms.created', row!.id, { terms: dto.terms });
    synonymsChanged();
    return publicGroup(row!);
  }

  async updateSynonyms(adminId: string, id: string, dto: SynonymGroupDto) {
    await this.refuseOverlap(dto.terms, id);
    const row = await this.db.one<SearchSynonymRow>(
      'update public.search_synonyms set kind = $2, terms = $3, updated_at = now() where id = $1 returning *',
      [id, dto.kind, dto.terms],
    );
    if (!row) throw notFound('Synonym group');
    await this.log.write(adminId, 'search_synonyms.updated', id, { terms: dto.terms });
    synonymsChanged();
    return publicGroup(row);
  }

  async removeSynonyms(adminId: string, id: string) {
    const row = await this.db.one<{ terms: string[] }>(
      'delete from public.search_synonyms where id = $1 returning terms',
      [id],
    );
    if (!row) throw notFound('Synonym group');
    await this.log.write(adminId, 'search_synonyms.deleted', id, { terms: row.terms });
    synonymsChanged();
  }

  /**
   * A name can live in one group only: in two, a search for it would join both groups into one, which nobody meant. The error
   * names the group it's already in, so staff can add to that one instead.
   */
  private async refuseOverlap(terms: string[], self: string | null) {
    const groups = await this.db.many<{ id: string; terms: string[] }>(
      'select id, terms from public.search_synonyms',
    );
    const owner = new Map<string, string[]>();
    for (const g of groups)
      if (g.id !== self) for (const t of g.terms) owner.set(foldSearch(t), g.terms);
    for (const term of terms) {
      const other = owner.get(foldSearch(term));
      if (other)
        throw new AppError(
          `"${term}" is already in the group "${other.slice(0, 3).join(', ')}". Add to that group instead.`,
          409,
        );
    }
  }
}

const publicGroup = (r: SearchSynonymRow) => ({
  id: r.id,
  kind: r.kind,
  terms: r.terms,
  updatedAt: r.updated_at,
});
