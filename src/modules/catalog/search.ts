/**
 * Shop search helpers. A search is split into words and every word has to appear somewhere on the product (name, series,
 * character, maker, JAN code or category), so "miku figure" finds "Hatsune Miku Luminasta Figure" in Prize Figures.
 * When nothing matches, `didYouMean` fixes typos against the words the catalogue actually uses ("hatsne miku" → "hatsune miku").
 */
import { likePattern } from '../../common/validation/rules.js';
import { SYNONYM_GROUPS } from './synonyms.js';

/** Accented letters and the plain letter each one counts as, so "pokemon" finds "Pokémon" and "ryujin" finds "Ryūjin". */
const ACCENTS: [string, string][] = [
  ['àáâãäåā', 'a'],
  ['ç', 'c'],
  ['èéêëē', 'e'],
  ['ìíîïī', 'i'],
  ['ñ', 'n'],
  ['òóôõöō', 'o'],
  ['ùúûüū', 'u'],
  ['ýÿ', 'y'],
];
const ACCENT_FROM = ACCENTS.map(([from]) => from).join('');
const ACCENT_TO = ACCENTS.map(([from, to]) => to.repeat(from.length)).join('');

/**
 * Text as search compares it: lower case, accents off, punctuation as a space ("Re:Zero" and "re zero" are the same).
 * Only ASCII punctuation goes, so Japanese and symbols like ★ stay as they are. SQL twin: `searchableSql`.
 */
export function foldSearch(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    const at = ACCENT_FROM.indexOf(ch);
    out += at === -1 ? ch : ACCENT_TO[at];
  }
  return out.replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\s]+/g, ' ').trim();
}

/** `foldSearch` in Postgres, for a text expression (in the C locale, [:punct:] is ASCII punctuation only). */
export const searchableSql = (expr: string) =>
  `trim(regexp_replace(translate(lower(${expr}), '${ACCENT_FROM}', '${ACCENT_TO}'), '[[:punct:][:space:]]+', ' ', 'g'))`;

/** At most this many words count; the rest of a pasted paragraph is ignored. */
export const MAX_SEARCH_WORDS = 8;

/**
 * The words of a search, folded (see `foldSearch`), without duplicates. A word with punctuation inside stays one phrase:
 * "re:zero" is matched as "re zero", "rx-78-2" as "rx 78 2".
 */
export function searchWords(q: string): string[] {
  const words = q.split(/\s+/).map(foldSearch).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_SEARCH_WORDS);
}

/** The catalogue's own words, for typo fixes: letters and digits only, three characters or more. */
export function vocabulary(texts: (string | null | undefined)[]): Set<string> {
  const vocab = new Set<string>();
  for (const text of texts) {
    for (const word of foldSearch(text ?? '').split(/[^\p{L}\p{N}]+/u)) {
      if (word.length >= 3) vocab.add(word);
    }
  }
  return vocab;
}

/** Edits (insert, delete, change, swap two neighbours) to turn a into b, or Infinity once it passes `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return Infinity;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}

/** How many typos a word of this length may have: 1 up to 5 letters, 2 up to 9, then 3. */
const allowedEdits = (word: string) => (word.length <= 5 ? 1 : word.length <= 9 ? 2 : 3);

/**
 * The search with each unknown word swapped for the closest catalogue word, or null when nothing changes. Words the catalogue
 * already has, numbers, codes and anything that isn't Latin letters (Japanese searches) are left as typed.
 */
export function didYouMean(q: string, vocab: Set<string>): string | null {
  let changed = false;
  const fixed = searchWords(q).map((word) => {
    if (vocab.has(word) || word.length < 3 || !/^[a-z]+$/.test(word)) return word;
    let best: string | null = null;
    let bestDistance = allowedEdits(word);
    for (const candidate of vocab) {
      const d = editDistance(word, candidate, bestDistance);
      if (d === Infinity) continue;
      // ties go to the longer word ("figur" → "figure", not "fig"), then alphabetical so the answer never flips
      const better =
        !best ||
        d < bestDistance ||
        candidate.length > best.length ||
        (candidate.length === best.length && candidate < best);
      if (better) {
        best = candidate;
        bestDistance = d;
      }
    }
    if (!best) return word;
    changed = true;
    return best;
  });
  return changed ? fixed.join(' ') : null;
}

// ---------------------------------------------------------------- understanding a search

/** One thing a product has to match: what was typed (anywhere, even mid-word, so "frie" finds Frieren), or one of its synonyms
 * and singular forms (whole words only, so "pin" never matches "Spin"). */
export interface SearchTerm {
  typed: string;
  variants: string[];
}

export interface ParsedSearch {
  terms: SearchTerm[];
  /** The text that's left once filters are taken out, for "Did you mean". */
  text: string;
  minCents?: number;
  maxCents?: number;
  status?: 'in' | 'pre';
  /** Plain words for the filters found ("under $50", "in stock"), so the shop can say what it understood. */
  understood: string[];
}

const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  const folded = group.map(foldSearch);
  for (const entry of folded)
    SYNONYMS.set(entry, [...new Set([...(SYNONYMS.get(entry) ?? []), ...folded])]);
}
/** The longest synonym, in words: how far ahead to look for a name like "spy x family". */
const LONGEST_SYNONYM = Math.max(...[...SYNONYMS.keys()].map((k) => k.split(' ').length));

const MONEY = String.raw`\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*(?:\$|dollars?|cad|usd)?`;
const FILTERS: { re: RegExp; apply: (m: RegExpMatchArray, out: ParsedSearch) => void }[] = [
  {
    re: new RegExp(String.raw`\$\s*(\d{1,5})\s*(?:-|–|to)\s*\$?\s*(\d{1,5})`),
    apply: (m, out) => {
      out.minCents = Number(m[1]) * 100;
      out.maxCents = Number(m[2]) * 100;
      out.understood.push(`$${m[1]}–$${m[2]}`);
    },
  },
  {
    re: new RegExp(String.raw`(?:\b(?:under|below|less than|cheaper than)|<)\s*${MONEY}`),
    apply: (m, out) => {
      out.maxCents = Math.round(Number(m[1]) * 100);
      out.understood.push(`under $${m[1]}`);
    },
  },
  {
    re: new RegExp(String.raw`(?:\b(?:over|above|more than)|>)\s*${MONEY}`),
    apply: (m, out) => {
      out.minCents = Math.round(Number(m[1]) * 100);
      out.understood.push(`over $${m[1]}`);
    },
  },
  {
    re: /\b(?:in[ -]stock|available now|ready to ship)\b/,
    apply: (_m, out) => {
      out.status = 'in';
      out.understood.push('in stock');
    },
  },
  {
    re: /\bpre[ -]?orders?\b/,
    apply: (_m, out) => {
      out.status = 'pre';
      out.understood.push('pre-orders');
    },
  },
];

/** Singular forms of an English word, as extra whole-word variants: "plushies" → plush, "figures" → figure. */
function singulars(word: string): string[] {
  if (!/^[a-z]{4,}$/.test(word)) return [];
  const out: string[] = [];
  if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`, word.slice(0, -3));
  else if (word.endsWith('es')) out.push(word.slice(0, -2), word.slice(0, -1));
  else if (word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1));
  return out.filter((w) => w.length >= 3);
}

/**
 * A search as the shop understands it: price and stock filters taken out of the words ("miku under $50 in stock"), names of
 * several words kept together ("spy x family"), and each word with its synonyms and singular forms.
 */
export function parseSearch(q: string): ParsedSearch {
  const out: ParsedSearch = { terms: [], text: '', understood: [] };
  let rest = q.toLowerCase().slice(0, 100);
  for (const f of FILTERS) {
    const m = rest.match(f.re);
    if (!m) continue;
    f.apply(m, out);
    rest = rest.replace(m[0], ' ');
  }
  const pieces = rest.split(/\s+/).map(foldSearch).filter(Boolean);
  out.text = pieces.join(' ');
  const units: string[] = [];
  for (let i = 0; i < pieces.length;) {
    let k = Math.min(LONGEST_SYNONYM, pieces.length - i);
    while (k > 1 && !SYNONYMS.has(pieces.slice(i, i + k).join(' '))) k--;
    units.push(pieces.slice(i, i + k).join(' '));
    i += k;
  }
  for (const unit of [...new Set(units)].slice(0, MAX_SEARCH_WORDS)) {
    const variants = new Set<string>();
    for (const form of [unit, ...singulars(unit)]) {
      if (form !== unit) variants.add(form);
      for (const syn of SYNONYMS.get(form) ?? []) variants.add(syn);
    }
    variants.delete(unit);
    out.terms.push({ typed: unit, variants: [...variants] });
  }
  return out;
}

/** The catalogue's words plus every synonym, for typo fixes ("pokemn" → "pokemon" even if no product says Pokemon). */
export const SYNONYM_WORDS = [...SYNONYMS.keys()];

/**
 * The SQL test for one term against a folded text expression, and the values it needs (in order): what was typed anywhere in
 * the text, then the Latin variants as whole words (plural allowed), then the Japanese ones anywhere (Japanese has no spaces).
 */
export function termSql(term: SearchTerm, text: string, at: (value: unknown) => string): string {
  const latin = term.variants.filter((v) => /^[a-z0-9 ]+$/.test(v));
  const other = term.variants.filter((v) => !/^[a-z0-9 ]+$/.test(v));
  const parts = [`${text} ilike ${at(likePattern(term.typed))}`];
  if (latin.length) parts.push(`${text} ~ ${at(String.raw`\m(?:${latin.join('|')})(?:s|es)?\M`)}`);
  if (other.length) parts.push(`${text} ilike any(${at(other.map(likePattern))}::text[])`);
  return `(${parts.join(' or ')})`;
}
