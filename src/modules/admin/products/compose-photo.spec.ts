import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { composeOnBackground, hasTransparency, PHOTO_PADDING } from './compose-photo.js';

/** A box-shaped product (opaque blue rectangle) in the middle of a transparent picture, as Gleamshelf cuts a box out. */
const boxCutout = () =>
  sharp({
    create: { width: 600, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: 400,
            height: 300,
            channels: 4,
            background: { r: 20, g: 40, b: 200, alpha: 1 },
          },
        },
        left: 100,
        top: 100,
      },
    ])
    .png()
    .toBuffer();
const grey = async (jpeg: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};

describe('composeOnBackground', () => {
  it('fits the product inside the padding, centred, with a soft shadow that fades to nothing (never a dark frame)', async () => {
    const size = 1000;
    const out = await composeOnBackground(await boxCutout(), null, size);
    // the product, trimmed of its transparent margin, fills the width inside the padding: 840 wide, 630 tall, centred
    const inner = size * (1 - 2 * PHOTO_PADDING);
    const top = Math.round((size - inner * 0.75) / 2);
    const middle = await grey(out, size / 2, size / 2);
    expect(middle[2]).toBeGreaterThan(150); // blue
    // just under the product: a little darker than white (the shadow)
    const under = (await grey(out, size / 2, Math.round(top + inner * 0.75 + 6)))[0];
    expect(under).toBeLessThan(250);
    expect(under).toBeGreaterThan(180);
    // well beside the product, still inside where the shadow picture lies: plain white (an earlier version left a flat grey rectangle here)
    expect(await grey(out, Math.round(PHOTO_PADDING * size) - 30, size / 2)).toEqual([
      255, 255, 255,
    ]);
    expect(await grey(out, 5, 5)).toEqual([255, 255, 255]);
  });

  it('fills the square with the background, cropped from its centre', async () => {
    const back = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: { r: 200, g: 120, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    const out = await composeOnBackground(await boxCutout(), back, 800);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([800, 800]);
    const corner = await grey(out, 3, 3);
    expect(
      Math.abs(corner[0] - 200) + Math.abs(corner[1] - 120) + Math.abs(corner[2] - 40),
    ).toBeLessThan(20);
  });

  it('tells a cut-out from a photo with no see-through pixels', async () => {
    expect(await hasTransparency(await boxCutout())).toBe(true);
    expect(
      await hasTransparency(
        await sharp({
          create: {
            width: 10,
            height: 10,
            channels: 4,
            background: { r: 1, g: 2, b: 3, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
      ),
    ).toBe(false);
    expect(await hasTransparency(Buffer.from('not a picture'))).toBe(false);
  });
});
