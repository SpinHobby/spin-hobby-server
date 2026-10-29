import { describe, expect, it } from 'vitest';
import { awayAnswer, matchProducts, words, type MatchProduct } from './match.js';

const p = (name: string, more: Partial<MatchProduct> = {}): MatchProduct => ({
  id: name,
  name,
  status: 'in',
  priceCents: 2900,
  ...more,
});
const SHOP = [
  p('Nendoroid Hatsune Miku', { series: 'Vocaloid' }),
  p('Nendoroid Kirby', { status: 'out', priceCents: 5499 }),
  p('Chiikawa Plush', { series: 'Chiikawa', status: 'low', stockCount: 2 }),
  p('Chiikawa Mini Figure', { series: 'Chiikawa' }),
  // listed first, so only the ranking can put the kit ahead of it
  p('Gundam Marker Basic Set', {
    series: 'Gundam Marker',
    category: 'Tools & Paint',
    categoryPath: 'Model Kits › Tools & Paint',
  }),
  p('Entry Grade 1/144 Strike Gundam', {
    series: 'Gundam SEED',
    category: 'Gunpla',
    categoryPath: 'Model Kits › Gunpla',
  }),
  p('Labubu Blind Box', { status: 'pre', priceCents: 2299 }),
];

describe('the away answer', () => {
  it('finds the products a question is about, plurals and short forms included', () => {
    expect(words('Do you have Pokémon plushies?')).toEqual(['pokemon', 'plushies']);
    expect(matchProducts('is the miku nendoroid in stock?', SHOP).map((x) => x.name)).toEqual([
      'Nendoroid Hatsune Miku',
    ]);
    expect(matchProducts('any nendos', SHOP).map((x) => x.name)).toEqual([
      'Nendoroid Hatsune Miku',
      'Nendoroid Kirby',
    ]);
    expect(matchProducts('when do you open', SHOP)).toEqual([]);
    // a question names the parent category (Model Kits) as often as the leaf (Gunpla); the kits come before the tools filed there
    // too, unless the question asks for tools
    expect(matchProducts('any gundam model kits?', SHOP).map((x) => x.name)).toEqual([
      'Entry Grade 1/144 Strike Gundam',
      'Gundam Marker Basic Set',
    ]);
    expect(matchProducts('do you have gundam markers?', SHOP).map((x) => x.name)[0]).toBe(
      'Gundam Marker Basic Set',
    );
    // "plushies" is about the plush, not every Chiikawa product
    expect(matchProducts('chiikawa plushies', SHOP).map((x) => x.name)).toEqual(['Chiikawa Plush']);
  });

  it('says what it found with prices and stock, and that the talking assistant is away', () => {
    expect(awayAnswer(matchProducts('chiikawa plushies', SHOP))).toBe(
      'Here is what I found: Chiikawa Plush ($29, only 2 left). The talking assistant is away right now, so for anything else, message the shop.',
    );
    expect(awayAnswer([])).toMatch(
      /^I couldn't find that in the shop\. The talking assistant is away/,
    );
  });
});
