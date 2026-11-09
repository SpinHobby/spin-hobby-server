import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { GlossaryTermRow } from '../../database/rows.js';

const LIST_TERMS = 'select id, term, meaning from public.glossary_terms order by lower(term)';

/** The collector's glossary: words shoppers meet on product pages, with what they mean. */
@Injectable()
export class GlossaryService {
  constructor(private readonly db: Db) {}

  /** Every term, A to Z. */
  list() {
    return this.db.many<Pick<GlossaryTermRow, 'id' | 'term' | 'meaning'>>(LIST_TERMS);
  }

  /** Adds a term. A term that already exists (ignoring case and spacing) is refused, so nothing is listed twice. */
  async create(term: string, meaning: string) {
    const row = await this.db.one<Pick<GlossaryTermRow, 'id' | 'term' | 'meaning'>>(
      `insert into public.glossary_terms (term, meaning) values ($1, $2)
       on conflict (lower(btrim(term))) do nothing
       returning id, term, meaning`,
      [term, meaning],
    );
    if (!row) throw new AppError(`"${term}" is already in the glossary.`, 409);
    return row;
  }
}
