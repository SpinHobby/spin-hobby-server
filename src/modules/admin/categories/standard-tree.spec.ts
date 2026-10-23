import { describe, expect, it } from 'vitest';
import { STANDARD_TREE, suggestCategory } from './standard-tree.js';

const where = (name: string, square: string | null = null) =>
  suggestCategory(name, square)?.category ?? null;

describe('the ready-made category tree', () => {
  it('has no repeated names, so a suggestion names one category', () => {
    const names = STANDARD_TREE.flatMap((t) => [t.name, ...t.children]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length - 1); // "Trading Cards" is both a group and a leaf
  });
});

describe('suggestCategory', () => {
  it.each([
    ['Demon Slayer Chibi Figure Blind Box', 'Trading & Blind Box Figures'],
    ['Nendoroid Frieren', 'Chibi Figures'],
    ['figma Hatsune Miku V4X', 'Action Figures'],
    ['S.H.Figuarts Son Goku: Legendary Super Saiyan', 'Action Figures'],
    ['One Piece Card Game OP-10 Booster Box', 'Card Games'],
    ['Pokémon TCG: Scarlet & Violet Booster Pack', 'Card Games'],
    ['Dragon Shield Matte Sleeves (100)', 'Card Supplies'],
    ['Chiikawa Plush Mascot', 'Plush'],
    ['Frieren Acrylic Stand', 'Acrylic Stands & Keychains'],
    ['Jujutsu Kaisen Can Badge Set', 'Can Badges & Pins'],
    ['Hololive B2 Tapestry', 'Tapestries & Posters'],
    ['Evangelion: 3.0+1.0 Thrice Upon a Time Blu-ray', 'Blu-ray & DVD'],
    ['Spy x Family Vol. 12', 'Books & Manga'],
    ['Genshin Impact Art Book', 'Art Books'],
    ['Sanrio 1000-piece Jigsaw Puzzle', 'Jigsaw Puzzles'],
    ['Kamen Rider DX Henshin Belt', 'Tokusatsu Toys'],
    ['Pullip Doll Alice', 'Dolls'],
    ['Studio Ghibli Mug', 'Household Goods'],
    ['Ichiban Kuji Frieren Last One Prize Figure', 'Kuji Prize Figures'],
    ['一番くじ 呪術廻戦 A賞 五条悟 フィギュア', 'Kuji Prize Figures'],
    ['Hatsune Miku Luminasta Figure', 'Kuji Prize Figures'],
    ['Kamen Rider Prize Figure', 'Kuji Prize Figures'],
    ['Ichiban Kuji Jujutsu Kaisen Towel', 'Household Goods'], // a kuji prize that isn't a figure
    ['Ichiban Kuji Last One Prize Acrylic Stand', 'Acrylic Stands & Keychains'],
    ['Cars Lightning McQueen Plush', 'Plush'],
  ])('%s → %s', (name, category) => expect(where(name)).toBe(category));

  it("uses the Square category for a plain figure: the shop's split into girls and other characters", () => {
    expect(where('Rem Precious Figure', 'Bishoujo Figures')).toBe('Bishoujo Figures');
    // the shop's "Action Figures" in Square holds figures of male characters: a character figure, unless the name says it's poseable
    expect(where('Satoru Gojo 1/7 Scale Figure', 'Action Figures')).toBe('Character Figures');
    expect(where('figma Guts', 'Action Figures')).toBe('Action Figures');
  });

  it('asks a person to choose when nothing says whether the character is a girl', () => {
    const s = suggestCategory('Pop Up Parade Makima', null);
    expect(s).toMatchObject({ category: null, choices: ['Bishoujo Figures', 'Character Figures'] });
  });

  it('suggests nothing for model kits and vehicle models (no longer in the tree), rather than calling them figures', () => {
    for (const name of [
      'HG 1/144 Gundam Aerial',
      'Figure-rise Standard Ultraman',
      'Tamiya 1/35 Tiger I Tank Kit',
      '1/24 Nissan Skyline GT-R (R34)',
      'Gundam Marker Set',
    ])
      expect(where(name)).toBeNull();
    expect(where('Miku Figure', 'Prize Figures')).toBe('Kuji Prize Figures'); // the shop's own Square category
  });

  it('falls back to the Square category, and gives nothing when nothing points anywhere', () => {
    expect(where('Gojo Satoru', 'Plushies')).toBe('Plush');
    expect(where('Mystery item', null)).toBeNull();
  });

  it('says why', () => {
    expect(suggestCategory('Frieren Acrylic Stand', null)?.reason).toBe('"Acrylic" in the name');
  });
});
