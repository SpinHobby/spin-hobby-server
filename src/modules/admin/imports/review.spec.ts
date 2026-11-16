import { describe, expect, it } from 'vitest';
import { reviewDraft } from './review.js';

const draft = {
  title: 'Yukihana Lamy Figure (hololive)',
  description: 'A prize figure of Yukihana Lamy.',
  series: 'hololive',
  categoryId: 'cat-figures',
  photosEdited: 0,
  market: { low: 30, high: 55.5 },
};
const added = {
  name: 'Yukihana Lamy Figure (hololive)',
  description: 'A prize figure of Yukihana Lamy.',
  series: 'hololive',
  categoryId: 'cat-figures',
  priceCents: 4500,
};

describe('reviewDraft', () => {
  it('counts a draft added as sent as unedited, ignoring spaces and case', () => {
    expect(
      reviewDraft(draft, {
        ...added,
        name: '  yukihana lamy  figure (Hololive) ',
        description: 'A prize figure of\nYukihana Lamy.',
      }),
    ).toEqual({ changed: [], priceInMarket: true });
  });

  it('names each field a person changed, photos included', () => {
    expect(
      reviewDraft(
        { ...draft, photosEdited: 2 },
        { ...added, name: 'Lamy Relax Time', series: null, categoryId: 'cat-other' },
      ).changed,
    ).toEqual(['title', 'series', 'category', 'photos']);
  });

  it('treats a missing and an empty description as the same', () => {
    expect(
      reviewDraft({ ...draft, description: null }, { ...added, description: '' }).changed,
    ).toEqual([]);
  });

  it('checks the price against the market range, edges included, and says null without one', () => {
    expect(reviewDraft(draft, { ...added, priceCents: 3000 }).priceInMarket).toBe(true);
    expect(reviewDraft(draft, { ...added, priceCents: 5550 }).priceInMarket).toBe(true);
    expect(reviewDraft(draft, { ...added, priceCents: 5551 }).priceInMarket).toBe(false);
    expect(reviewDraft({ ...draft, market: null }, added).priceInMarket).toBeNull();
  });
});
