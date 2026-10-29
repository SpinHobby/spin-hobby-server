/**
 * Which products a visitor's question is about, for the text answer the shop gives when its talking assistant (the Gleamshelf app on the
 * shop's computer) is away. Pure: words in the question against each product's name, series, character and category. The same idea as
 * the assistant's own search in Gleamshelf (apps/local/src/agent.ts), so the two agree.
 */

export interface MatchProduct {
  id: string;
  name: string;
  series?: string | null;
  character?: string | null;
  category?: string | null;
  status: string;
  priceCents: number;
  stockCount?: number | null;
}

/** Words that say nothing about which product is meant. */
const STOP = new Set(
  `a an and any are as at be been by can could did do does for from get got have has hi hello hey how i if in is it its just like me my
  of on or please price prices cost costs much many stock still the there this that these those to too what when where which who why will
  with would you your yours u ur pls plz thanks thank one ones some new available left sell selling buy about tell show`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lower case, accents off, split into words (Pokémon -> pokemon). */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** The products a question is about, best first; only those matching the most of its words, and at least half of them. */
export function matchProducts<P extends MatchProduct>(
  question: string,
  products: readonly P[],
  max = 4,
): P[] {
  const asked = [...new Set(words(question))];
  if (!asked.length) return [];
  const scored = products.map((p) => {
    const fields: [string[], number][] = [
      [words(p.name), 3],
      [words(`${p.series ?? ''} ${p.character ?? ''}`), 2],
      [words(p.category ?? ''), 1],
    ];
    let score = 0,
      hits = 0;
    for (const asWritten of asked) {
      let best = 0;
      const forms =
        asWritten.length >= 4 && asWritten.endsWith('s')
          ? [asWritten, asWritten.slice(0, -1)]
          : [asWritten];
      for (const w of forms)
        for (const [ws, weight] of fields)
          if (ws.includes(w) || ws.includes(`${w}s`)) best = Math.max(best, weight);
          // a short form (nendo: nendoroid) or a longer one (plushies: plush) of a product's word
          else if (
            w.length >= 4 &&
            ws.some((x) => x.startsWith(w) || (x.length >= 4 && w.startsWith(x)))
          )
            best = Math.max(best, weight * 0.6);
      if (best) hits++;
      score += best;
    }
    const now = p.status === 'in' || p.status === 'low' ? 0.5 : p.status === 'pre' ? 0.3 : 0;
    return { p, score: score + (score ? now : 0), hits };
  });
  const need = Math.max(1, Math.ceil(asked.length / 2), ...scored.map((s) => s.hits));
  return scored
    .filter((s) => s.hits >= need)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.p);
}

export function priceText(cents: number): string {
  const amount = (cents / 100).toFixed(2);
  return `$${amount.endsWith('.00') ? amount.slice(0, -3) : amount}`;
}

export function statusText(p: MatchProduct): string {
  if (p.status === 'in') return 'in stock';
  if (p.status === 'low') return p.stockCount ? `only ${p.stockCount} left` : 'only a few left';
  if (p.status === 'pre') return 'pre-order';
  return 'sold out';
}

/** The shop's own text answer while the talking assistant is away: what matched, or where else to look. */
export function awayAnswer(found: readonly MatchProduct[]): string {
  const away = 'The talking assistant is away right now, so for anything else, message the shop.';
  if (!found.length) return `I couldn't find that in the shop. ${away}`;
  const list = found
    .map((p) => `${p.name} (${priceText(p.priceCents)}, ${statusText(p)})`)
    .join('; ');
  return `Here is what I found: ${list}. ${away}`;
}
