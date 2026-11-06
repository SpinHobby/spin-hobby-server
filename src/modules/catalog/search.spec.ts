import { describe, expect, it } from 'vitest';
import { didYouMean, editDistance, searchWords, vocabulary } from './search.js';

const vocab = vocabulary([
  'Hatsune Miku Luminasta Figure',
  'Re:Zero Rem 1/7 Scale Figure',
  'Frieren: Beyond Journey’s End',
  'Good Smile Company',
  'Fig Keychain',
]);

describe('searchWords', () => {
  it('splits on spaces, lower-cases, drops edge punctuation and repeats', () => {
    expect(searchWords('  Miku, FIGURE miku ')).toEqual(['miku', 'figure']);
    expect(searchWords('re:zero 1/7 rx-78-2')).toEqual(['re:zero', '1/7', 'rx-78-2']);
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
