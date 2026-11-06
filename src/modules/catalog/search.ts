/**
 * Shop search helpers. A search is split into words and every word has to appear somewhere on the product (name, series,
 * character, maker, JAN code or category), so "miku figure" finds "Hatsune Miku Luminasta Figure" in Prize Figures.
 * When nothing matches, `didYouMean` fixes typos against the words the catalogue actually uses ("hatsne miku" → "hatsune miku").
 */

/** At most this many words count; the rest of a pasted paragraph is ignored. */
export const MAX_SEARCH_WORDS = 8;

/** The words of a search, lower case, without duplicates. Punctuation inside a word stays (re:zero, 1/7, rx-78-2). */
export function searchWords(q: string): string[] {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_SEARCH_WORDS);
}

/** The catalogue's own words, for typo fixes: letters and digits only, three characters or more. */
export function vocabulary(texts: (string | null | undefined)[]): Set<string> {
  const vocab = new Set<string>();
  for (const text of texts) {
    for (const word of (text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
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
