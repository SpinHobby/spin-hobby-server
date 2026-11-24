import { describe, expect, it } from 'vitest';
import { ownBackground } from './product-background.js';

const none = { mode: null, libraryUrl: null, boxArtUrl: null };

describe("a product's own background", () => {
  it('is the shop background (nothing of its own) when it has no choice and the rule is the shop background', () => {
    expect(ownBackground(none, 'shop')).toBeUndefined();
    expect(ownBackground({ ...none, boxArtUrl: 'https://x/art.jpg' }, 'shop')).toBeUndefined();
  });
  it('is its box art under the box-art rule, where it has one', () => {
    expect(ownBackground({ ...none, boxArtUrl: 'https://x/art.jpg' }, 'box_art')).toEqual({
      url: 'https://x/art.jpg',
    });
    expect(ownBackground(none, 'box_art')).toBeUndefined();
  });
  it("follows the product's own choice over the rule", () => {
    expect(
      ownBackground({ ...none, mode: 'white', boxArtUrl: 'https://x/art.jpg' }, 'box_art'),
    ).toEqual({ url: null });
    expect(
      ownBackground({ ...none, mode: 'shop', boxArtUrl: 'https://x/art.jpg' }, 'box_art'),
    ).toBeUndefined();
    expect(
      ownBackground({ mode: 'library', libraryUrl: 'https://x/bg.webp', boxArtUrl: null }, 'shop'),
    ).toEqual({
      url: 'https://x/bg.webp',
    });
    expect(
      ownBackground({ ...none, mode: 'box_art', boxArtUrl: 'https://x/art.jpg' }, 'shop'),
    ).toEqual({ url: 'https://x/art.jpg' });
  });
  it('falls back to the shop background when the chosen box art or library background is not there', () => {
    expect(ownBackground({ ...none, mode: 'box_art' }, 'shop')).toBeUndefined();
    expect(ownBackground({ ...none, mode: 'library' }, 'shop')).toBeUndefined();
  });
});
