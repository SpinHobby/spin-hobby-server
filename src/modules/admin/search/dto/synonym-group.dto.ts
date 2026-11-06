import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';
import { foldSearch } from '../../../catalog/search.js';

export const SYNONYM_KINDS = ['type', 'series', 'maker', 'other'] as const;
export type SynonymKind = (typeof SYNONYM_KINDS)[number];
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 60;

/** One synonym group: two or more names for the same thing, as staff typed them. */
export class SynonymGroupDto {
  /** `type` (figure, plush), `series` (Frieren), `maker` (Good Smile) or `other`: only for sorting the list in Admin. */
  @Rule((v) => {
    if (!SYNONYM_KINDS.includes(v as SynonymKind))
      throw new AppError('Kind must be type, series, maker or other.');
    return v;
  })
  kind!: SynonymKind;

  /** 2 to 12 names; spaces are tidied, and two names that search the same ("Pokémon", "pokemon") count once. */
  @Rule((v) => {
    if (!Array.isArray(v)) throw new AppError('Terms must be a list of names.');
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const raw of v) {
      if (typeof raw !== 'string') throw new AppError('Each term must be text.');
      const term = raw.replace(/\s+/g, ' ').trim();
      if (!term) continue;
      if (term.length > MAX_TERM_LENGTH)
        throw new AppError(`Keep each term under ${MAX_TERM_LENGTH} characters.`);
      const key = foldSearch(term);
      if (!key) throw new AppError(`"${term}" has no letters or numbers to search for.`);
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
    if (terms.length < 2) throw new AppError('A group needs at least two different names.');
    if (terms.length > MAX_TERMS) throw new AppError(`A group can hold up to ${MAX_TERMS} names.`);
    return terms;
  })
  terms!: string[];
}
