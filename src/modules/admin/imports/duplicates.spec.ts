import { describe, expect, it } from 'vitest';
import {
  distinctiveTokens,
  likelySameProducts,
  matchScore,
  type ShopProduct,
} from './duplicates.js';

const product = (name: string, over: Partial<ShopProduct> = {}): ShopProduct => ({
  id: name,
  name,
  series: null,
  character: null,
  stockCount: 1,
  imageUrl: null,
  hidden: false,
  ...over,
});

describe('distinctiveTokens', () => {
  it('keeps the words that say which product it is', () => {
    expect([...distinctiveTokens('Rem Figure (Re:Zero ～AnimalParade～) A Prize Ver.')]).toEqual([
      'rem',
      're',
      'zero',
      'animalparade',
    ]);
  });
});

describe('likelySameProducts', () => {
  const shop = [
    product('Rem Animal Parade Figure', { series: 'Re:Zero', character: 'レム' }),
    product('Rem BiCute Bunnies Figure', { series: 'Re:Zero' }),
    product('Izou Figure', { series: 'One Piece' }),
    product('Ram Animal Parade Figure', { series: 'Re:Zero' }),
  ];

  it('finds the listing of the same product, ahead of other figures of the character', () => {
    const got = likelySameProducts(
      {
        title: 'Rem Animal Parade Figure (Re:Zero)',
        series: 'Re:Zero',
        read: 'レム / A賞 レムフィギュア',
      },
      shop,
    );
    expect(got[0].name).toBe('Rem Animal Parade Figure');
    expect(got.map((g) => g.name)).not.toContain('Izou Figure');
  });

  it('does not match another character of the same line', () => {
    const got = likelySameProducts(
      { title: 'Ram Animal Parade Figure (Re:Zero)', series: 'Re:Zero', read: null },
      shop,
    );
    expect(got.map((g) => g.name)).toEqual(['Ram Animal Parade Figure']);
  });

  it('finds nothing for a product the shop does not have', () => {
    expect(
      likelySameProducts(
        { title: 'Lamy Yukihana Figure (hololive)', series: 'hololive', read: null },
        shop,
      ),
    ).toEqual([]);
  });

  it('lowers a match whose series is clearly another one', () => {
    const a = matchScore(
      { title: 'Izou Figure (One Piece)', series: 'One Piece', read: null },
      product('Izou Figure', { series: 'One Piece' }),
    );
    const b = matchScore(
      { title: 'Izou Figure (Naruto)', series: 'Naruto', read: null },
      product('Izou Figure', { series: 'One Piece' }),
    );
    expect(a).toBeGreaterThan(b);
  });
});
