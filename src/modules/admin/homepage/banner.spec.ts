import { dealBackdrops, isLive, optionalMoment, pickedProducts } from './banner.js';

const p = (id: string) => ({ id });

describe('banner ads', () => {
  it('shows an ad only when it is on and inside its dates', () => {
    const now = new Date('2026-12-10T12:00:00Z');
    const ad = { is_visible: true, starts_at: null, ends_at: null };
    expect(isLive(ad, now)).toBe(true);
    expect(isLive({ ...ad, is_visible: false }, now)).toBe(false);
    expect(isLive({ ...ad, starts_at: '2026-12-20T00:00:00Z' }, now)).toBe(false);
    expect(isLive({ ...ad, starts_at: '2026-12-01T00:00:00Z' }, now)).toBe(true);
    expect(isLive({ ...ad, ends_at: '2026-12-10T12:00:00Z' }, now)).toBe(false);
    expect(isLive({ ...ad, ends_at: '2026-12-26T00:00:00Z' }, now)).toBe(true);
  });

  it('gives each ad different product pictures while there are enough', () => {
    const pool = 'abcdefghijkl'.split('').map(p);
    const dealt = dealBackdrops(
      [
        { backdrop: 'products', product_ids: [] },
        { backdrop: 'photo', product_ids: [] },
        { backdrop: 'products', product_ids: [] },
      ],
      new Map(),
      pool,
    );
    expect(dealt.map((d) => d.map((x) => x.id).join(''))).toEqual(['abcde', '', 'fghij']);
  });

  it('goes round again when the pool is small, and shows nothing with no products', () => {
    const ads = [
      { backdrop: 'products' as const, product_ids: [] },
      { backdrop: 'products' as const, product_ids: [] },
    ];
    expect(
      dealBackdrops(ads, new Map(), ['a', 'b', 'c'].map(p)).map((d) => d.map((x) => x.id).join('')),
    ).toEqual(['abc', 'abc']);
    expect(dealBackdrops(ads, new Map(), [])).toEqual([[], []]);
  });

  it('shows the picked products in the order picked, and falls back when none can be seen', () => {
    const pool = ['a', 'b'].map(p);
    const byId = new Map([
      ['x', p('x')],
      ['y', p('y')],
    ]);
    const dealt = dealBackdrops(
      [
        { backdrop: 'chosen', product_ids: ['y', 'gone', 'x'] },
        { backdrop: 'chosen', product_ids: ['gone'] },
      ],
      byId,
      pool,
    );
    expect(dealt.map((d) => d.map((x) => x.id).join(''))).toEqual(['yx', 'ab']);
  });

  it('checks picked products and dates', () => {
    expect(pickedProducts(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(() => pickedProducts('a')).toThrow();
    expect(() => pickedProducts(Array.from({ length: 13 }, (_, i) => `p${i}`))).toThrow();
    expect(optionalMoment('', 'startsAt')).toBeNull();
    expect(optionalMoment('2026-12-01T00:00:00-07:00', 'startsAt')).toBe(
      '2026-12-01T07:00:00.000Z',
    );
    expect(() => optionalMoment('soon', 'startsAt')).toThrow();
  });
});
