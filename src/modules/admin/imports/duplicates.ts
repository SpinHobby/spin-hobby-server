/**
 * Is a draft a product the shop already has? A photo of a box that is already listed should become more stock on that listing, not a second listing.
 * Names are compared by their distinctive words (the character, the line, the prize: "Rem", "Animal", "Parade"), not by words every figure listing has
 * ("Figure", "Prize", "Ver."); the series and the character agreeing count too. The result is only a suggestion: a person looks at the photos and decides.
 */

export interface ShopProduct {
  id: string;
  name: string;
  series: string | null;
  character: string | null;
  stockCount: number | null;
  imageUrl: string | null;
  hidden: boolean;
}

export interface DraftForMatching {
  title: string;
  series: string | null;
  /** What the box was read as (Japanese names, the prize), when the app sent it. */
  read: string | null;
}

export interface ProductMatch extends ShopProduct {
  /** 0 to 1: how much of the draft's distinctive name the product shares. */
  score: number;
}

/** Words every listing of a kind has: they say nothing about which product it is. */
const GENERIC = new Set([
  'figure',
  'figures',
  'figurine',
  'prize',
  'statue',
  'scale',
  'ver',
  'version',
  'the',
  'of',
  'and',
  'with',
  'from',
  'for',
  'new',
  'anime',
  'collection',
  'series',
  'vol',
  'edition',
  'special',
  'premium',
  'limited',
  'ichiban',
  'kuji',
  'banpresto',
  'bandai',
  'spirits',
]);

const flat = (s: string | null | undefined) => (s ?? '').normalize('NFKC').toLowerCase();

/** The distinctive words of a name: lower case, no punctuation, generic and one-letter words left out. Japanese runs are kept whole. */
export function distinctiveTokens(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of flat(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!t || GENERIC.has(t)) continue;
    if (/^[a-z]$/.test(t) || /^\d$/.test(t)) continue;
    out.add(t);
  }
  return out;
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const x = flat(a).replace(/[^\p{L}\p{N}]+/gu, ''),
    y = flat(b).replace(/[^\p{L}\p{N}]+/gu, '');
  return (
    !!x &&
    !!y &&
    (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))))
  );
};

/** How likely a shop product is the draft's product: the share of the draft's distinctive words the product's name has, with series and character agreeing as a bonus. */
export function matchScore(draft: DraftForMatching, product: ShopProduct): number {
  const ours = distinctiveTokens(draft.title.replace(/\([^)]*\)\s*$/, '')); // the series in brackets is compared on its own
  if (!ours.size) return 0;
  const theirs = distinctiveTokens(`${product.name} ${product.character ?? ''}`);
  const shared = [...ours].filter((t) => theirs.has(t)).length;
  // a shop title starts with who it is ("Rem ...", "Ram ..."): another character of the same line is another product
  if (!theirs.has([...ours][0])) return 0;
  let score = shared / ours.size;
  const seriesAgree =
    sameName(draft.series, product.series) ||
    (!!product.series && flat(draft.title).includes(flat(product.series)));
  if (seriesAgree) score += 0.15;
  else if (draft.series && product.series) score -= 0.25; // both know their series and they differ: almost surely another product
  if (product.character && (draft.read ?? '').includes(product.character)) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

/** The shop products the draft most likely is, best first: at most `max`, each sharing most of the draft's distinctive name. */
export function likelySameProducts(
  draft: DraftForMatching,
  products: ShopProduct[],
  max = 3,
  threshold = 0.6,
): ProductMatch[] {
  return products
    .map((p) => ({ ...p, score: Math.round(matchScore(draft, p) * 100) / 100 }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, max);
}
