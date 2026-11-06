import { describe, expect, it } from 'vitest';
import {
  didYouMean,
  editDistance,
  foldSearch,
  parseSearch,
  searchWords,
  vocabulary,
} from './search.js';

const vocab = vocabulary([
  'Hatsune Miku Luminasta Figure',
  'Re:Zero Rem 1/7 Scale Figure',
  'Frieren: Beyond Journey’s End',
  'Good Smile Company',
  'Fig Keychain',
]);

describe('foldSearch', () => {
  it('drops accents and case, and turns ASCII punctuation into single spaces', () => {
    expect(foldSearch('Pokémon')).toBe('pokemon');
    expect(foldSearch('Ryūjin  Kōta')).toBe('ryujin kota');
    expect(foldSearch('Re:Zero')).toBe('re zero');
    expect(foldSearch('RX-78-2 (Ver. B)')).toBe('rx 78 2 ver b');
  });

  it('keeps Japanese and symbols', () => {
    expect(foldSearch('初音ミク ★')).toBe('初音ミク ★');
  });
});

describe('searchWords', () => {
  it('splits on spaces, lower-cases, drops edge punctuation and repeats', () => {
    expect(searchWords('  Miku, FIGURE miku ')).toEqual(['miku', 'figure']);
    expect(searchWords('re:zero 1/7 Pokémon')).toEqual(['re zero', '1 7', 'pokemon']);
    expect(searchWords('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('editDistance', () => {
  it('counts changes, inserts, deletes and swaps', () => {
    expect(editDistance('miku', 'miku', 2)).toBe(0);
    expect(editDistance('mkiu', 'miku', 2)).toBe(1);
    expect(editDistance('maki', 'miku', 2)).toBe(2);
    expect(editDistance('maki', 'miku', 1)).toBe(Infinity);
    expect(editDistance('fiugre', 'figure', 2)).toBe(1); // a swap is one edit
    expect(editDistance('hatsne', 'hatsune', 1)).toBe(1);
  });
});

describe('didYouMean', () => {
  it('fixes each misspelt word against the catalogue', () => {
    expect(didYouMean('hatsne mikku', vocab)).toBe('hatsune miku');
    expect(didYouMean('freiren', vocab)).toBe('frieren');
    expect(didYouMean('figur', vocab)).toBe('figure'); // the longer of two equally close words
  });

  it('leaves known words, codes and Japanese alone, and says nothing when nothing changes', () => {
    expect(didYouMean('miku figure', vocab)).toBeNull();
    expect(didYouMean('4580000000001', vocab)).toBeNull();
    expect(didYouMean('ミク', vocab)).toBeNull();
    expect(didYouMean('zzzzqqq', vocab)).toBeNull(); // too far from every word
  });
});

describe('parseSearch', () => {
  const typed = (q: string) => parseSearch(q).terms.map((t) => t.typed);
  const variants = (q: string, i = 0) => parseSearch(q).terms[i].variants;

  it('takes price and stock filters out of the words and says what it understood', () => {
    const p = parseSearch('Miku figure under $50 in stock');
    expect(p.maxCents).toBe(5000);
    expect(p.status).toBe('in');
    expect(p.understood).toEqual(['under $50', 'in stock']);
    expect(typed('Miku figure under $50 in stock')).toEqual(['miku', 'figure']);
    expect(parseSearch('plush $20 to $40')).toMatchObject({ minCents: 2000, maxCents: 4000 });
    expect(parseSearch('nendoroid over 100 dollars')).toMatchObject({ minCents: 10000 });
    expect(parseSearch('frieren pre-orders')).toMatchObject({ status: 'pre', text: 'frieren' });
  });

  it('leaves numbers that are not prices alone', () => {
    expect(parseSearch('rem 1/7').maxCents).toBeUndefined();
    expect(typed('rem 1/7')).toEqual(['rem', '1 7']);
  });

  it('keeps names of several words together and adds their synonyms', () => {
    expect(typed('spy x family anya')).toEqual(['spy x family', 'anya']);
    expect(variants('初音ミク')).toEqual(expect.arrayContaining(['hatsune miku', 'miku']));
    expect(variants('jjk')).toContain('jujutsu kaisen');
    expect(variants('Pokémon')).toContain('ポケモン');
  });

  it('adds singular forms, and their synonyms', () => {
    expect(variants('plushies')).toEqual(
      expect.arrayContaining(['plush', 'plushie', 'ぬいぐるみ']),
    );
    expect(variants('figures')).toContain('figure');
    expect(variants('glass')).toEqual([]); // "ss" is not a plural
  });
});
