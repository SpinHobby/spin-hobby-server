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
