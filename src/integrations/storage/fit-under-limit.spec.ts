import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fitUnderLimit, MAX_IMAGE_BYTES } from './storage.service.js';

/** A 3072 px transparent square full of noise: a PNG far over 5 MB, like a big cut-out on a transparent square. */
const bigTransparentPng = async () => {
  const side = 3072;
  const data = Buffer.alloc(side * side * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 7) % 251;
    data[i + 1] = (i * 13) % 241;
    data[i + 2] = (i * 17) % 239;
    data[i + 3] = i % 3 ? 255 : 0; // see-through in places
  }
  return sharp(data, { raw: { width: side, height: side, channels: 4 } })
    .png()
    .toBuffer();
};

describe('images over the storage limit are made to fit (adding a product failed: "Images must be under 5 MB")', () => {
  it('keeps an image that already fits as it is', async () => {
    const small = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer();
    expect(await fitUnderLimit(small, 'image/jpeg')).toBe(small);
  });

  it('brings a 3072 px transparent PNG under 5 MB, still a PNG and still transparent', async () => {
    const big = await bigTransparentPng();
    expect(big.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    const fitted = await fitUnderLimit(big, 'image/png');
    expect(fitted).not.toBeNull();
    expect(fitted!.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    const meta = await sharp(fitted!).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBeGreaterThan(1000);
  });

  it('gives up on bytes that are not an image', async () => {
    expect(await fitUnderLimit(Buffer.alloc(MAX_IMAGE_BYTES + 10, 1), 'image/png')).toBeNull();
  });
});
