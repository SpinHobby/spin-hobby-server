/**
 * How much a person changed a Gleamshelf draft before adding it: the measure behind "listings accepted without edits" on Admin > Dashboard. Worked out
 * when the draft is added (the draft's own text is kept on the import row, but the product's text can change later for other reasons), and written
 * into the `imports.added` log entry as `review`.
 */
export type ReviewField = 'title' | 'description' | 'series' | 'category' | 'photos';
export const REVIEW_FIELDS: ReviewField[] = [
  'title',
  'description',
  'series',
  'category',
  'photos',
];

export interface DraftReview {
  /** What the person changed from the draft, in REVIEW_FIELDS order; empty when it went in as Gleamshelf sent it. */
  changed: ReviewField[];
  /** Whether the price typed sits inside the market range the draft carried (null: the draft had no market range). */
  priceInMarket: boolean | null;
}

/** Spaces, case and line breaks don't count as an edit; an empty text is the same as none. */
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() ===
  (b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function reviewDraft(
  draft: {
    title: string;
    description: string | null;
    series: string | null;
    /** The category the draft offered as one of the shop's (its id), or the id of the category it suggested once the shop has made it; null for none. */
    categoryId: string | null;
    /** Photos the person edited in the admin's photo editor. */
    photosEdited: number;
    /** The draft's market range in CAD dollars, if it had one. */
    market: { low: number; high: number } | null;
  },
  added: {
    name: string;
    description: string | null;
    series: string | null;
    categoryId: string | null;
    priceCents: number;
  },
): DraftReview {
  const changed: ReviewField[] = [];
  if (!same(draft.title, added.name)) changed.push('title');
  if (!same(draft.description, added.description)) changed.push('description');
  if (!same(draft.series, added.series)) changed.push('series');
  if ((draft.categoryId ?? null) !== (added.categoryId ?? null)) changed.push('category');
  if (draft.photosEdited > 0) changed.push('photos');
  const m = draft.market;
  const priceInMarket =
    m && m.high > 0
      ? added.priceCents >= Math.round(m.low * 100) && added.priceCents <= Math.round(m.high * 100)
      : null;
  return { changed, priceInMarket };
}
