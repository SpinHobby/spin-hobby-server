import { AppError } from '../../../common/errors.js';

/** What the sender says about a draft that is not a column of its own: kept as one JSON document, cut down to known fields and sizes. */
export interface DraftDetails {
  flags: string[];
  highlights: string[];
  unsupported: string[];
  unverifiedNumbers: string[];
  sources: string[];
  /** The product lookup's outcome: did it find the product online, and what was it read as. */
  lookup: { state: string; read: string | null; detail: string } | null;
  generator: string | null;
}

export interface DraftInput {
  sourceKey: string;
  title: string;
  description: string | null;
  category: string | null;
  series: string | null;
  details: DraftDetails;
}

/** Text without control characters (a new line and a tab stay). */
const withoutControls = (value: string) =>
  [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join('');

const text = (value: unknown, field: string, max: number, required = false): string | null => {
  if (value == null || value === '') {
    if (required) throw new AppError(`The draft needs a ${field}.`);
    return null;
  }
  if (typeof value !== 'string') throw new AppError(`The draft's ${field} must be text.`);
  const clean = withoutControls(value).trim();
  if (required && !clean) throw new AppError(`The draft needs a ${field}.`);
  return clean.slice(0, max) || null;
};

const list = (value: unknown, field: string, count: number, max: number): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AppError(`The draft's ${field} must be a list.`);
  return value
    .slice(0, count)
    .map((x) => text(typeof x === 'string' ? x : String(x), field, max))
    .filter((x): x is string => !!x);
};

/** Reads and cleans a draft the sender made. Anything it sent beyond these fields is dropped. */
export function parseDraft(raw: unknown): DraftInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError('The draft is not readable.');
  const d = raw as Record<string, unknown>;
  const sourceKey = text(d.sourceKey, 'source key', 128, true)!;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sourceKey))
    throw new AppError("The draft's source key is not valid.");
  const lookup =
    d.lookup && typeof d.lookup === 'object' ? (d.lookup as Record<string, unknown>) : null;
  return {
    sourceKey,
    title: text(d.title, 'title', 200, true)!,
    description: text(d.description, 'description', 2500),
    category: text(d.category, 'category', 120),
    series: text(d.series, 'series', 120),
    details: {
      flags: list(d.flags, 'flags', 20, 300),
      highlights: list(d.highlights, 'highlights', 8, 200),
      unsupported: list(d.unsupported, 'unsupported', 8, 200),
      unverifiedNumbers: list(d.unverifiedNumbers, 'numbers', 20, 40),
      sources: list(d.sources, 'sources', 12, 500).filter((u) => /^https:\/\//.test(u)),
      lookup: lookup
        ? {
            state: text(lookup.state, 'lookup state', 20) ?? 'off',
            read: text(lookup.read, 'lookup reading', 200),
            detail: text(lookup.detail, 'lookup detail', 400) ?? '',
          }
        : null,
      generator: text(d.generator, 'generator', 60),
    },
  };
}
