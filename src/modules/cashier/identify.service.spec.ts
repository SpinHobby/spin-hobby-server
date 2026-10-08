import { describe, expect, it } from 'vitest';
import { matchSeries, sanitizeArtworkCrop } from './identify.service.js';

describe('sanitizeArtworkCrop', () => {
  it('drops junk and clamps boxes into the photo', () => {
    expect(sanitizeArtworkCrop(null)).toBeUndefined();
    expect(sanitizeArtworkCrop({ x: 'a', y: 0, width: 1, height: 1 })).toBeUndefined();
    expect(
      sanitizeArtworkCrop({ x: 0.9, y: 0.9, width: 1, height: 1, rotationDegrees: -90 }),
    ).toEqual({
      x: 0.9,
      y: 0.9,
      width: expect.closeTo(0.1, 6),
      height: expect.closeTo(0.1, 6),
      rotationDegrees: -45,
    });
  });
});

describe('matchSeries', () => {
  const known = ['Re:Zero', 'Sousou no Frieren'];
  it('uses the spelling already in the list, whatever the AI wrote', () => {
    expect(matchSeries('Re Zero', known)).toEqual({ series: 'Re:Zero', seriesIsNew: false });
    expect(matchSeries(' re:zero ', known)).toEqual({ series: 'Re:Zero', seriesIsNew: false });
  });
  it('flags a series that is not in the list yet, and returns nothing when there is none', () => {
    expect(matchSeries('Dandadan', known)).toEqual({ series: 'Dandadan', seriesIsNew: true });
    expect(matchSeries('', known)).toEqual({});
    expect(matchSeries(undefined, known)).toEqual({});
  });
});
