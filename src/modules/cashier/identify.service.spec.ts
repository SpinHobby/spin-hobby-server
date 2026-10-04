import { describe, expect, it } from 'vitest';
import { sanitizeArtworkCrop } from './identify.service.js';

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
