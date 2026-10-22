import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('turns names into address form', () => {
    expect(slugify('Re:Zero')).toBe('re-zero');
    expect(slugify("Frieren: Beyond Journey's End")).toBe('frieren-beyond-journey-s-end');
    expect(slugify('Pokémon')).toBe('pokemon');
    expect(slugify('  Spy x Family  ')).toBe('spy-x-family');
  });
});
