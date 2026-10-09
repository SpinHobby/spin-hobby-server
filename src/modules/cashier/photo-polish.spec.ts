import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fillRegion, greenBorderShare, polishPhoto } from './photo-polish.js';

/** A "photo" of a purple box (with a cream sticker) on a green backdrop. */
async function boxOnGreen(withBackdrop = true) {
  const w = 600;
  const h = 400;
  const background = withBackdrop ? { r: 20, g: 130, b: 40 } : { r: 200, g: 190, b: 180 };
  const box = await sharp({
    create: { width: 300, height: 260, channels: 3, background: { r: 150, g: 80, b: 170 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 60, height: 24, channels: 3, background: '#f4efe2' },
        })
          .png()
          .toBuffer(),
        left: 200,
        top: 30,
      },
    ])
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background } })
    .composite([{ input: box, left: 150, top: 70 }])
    .png()
    .toBuffer();
}
const raw = async (png: Buffer) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};
const pixel = (d: Buffer, w: number, x: number, y: number) =>
  Array.from(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('polishPhoto', () => {
  it('removes a green backdrop and crops to the product, as a transparent PNG', async () => {
    const result = await polishPhoto(await boxOnGreen(), { removeBackground: true, stickers: [] });
    expect(result.backgroundRemoved).toBe(true);
    expect(result.contentType).toBe('image/png');
    const { data, w, h } = await raw(result.data);
    expect(pixel(data, w, 1, 1)[3]).toBe(0); // the corner is see-through
    expect(pixel(data, w, Math.floor(w / 2), Math.floor(h / 2))[3]).toBe(255); // the box is solid
    expect(w / h).toBeLessThan(600 / 400); // tighter than the original frame
    expect(w).toBeLessThan(450);
  });

  it('leaves a photo with no green backdrop alone (no transparency is invented)', async () => {
    const result = await polishPhoto(await boxOnGreen(false), {
      removeBackground: true,
      stickers: [],
    });
    expect(result.backgroundRemoved).toBe(false);
    const { data, w } = await raw(result.data);
    expect(pixel(data, w, 1, 1)[3]).toBe(255);
  });

  it('paints a sticker over with the colours around it', async () => {
    const photo = await boxOnGreen();
    const before = await raw(photo);
    // The sticker is at x 350-410, y 100-124 of a 600x400 photo.
    const stickerBox = { x: 350 / 600, y: 100 / 400, width: 60 / 600, height: 24 / 400 };
    expect(pixel(before.data, before.w, 380, 112).slice(0, 3)).toEqual([244, 239, 226]);
    const result = await polishPhoto(photo, { removeBackground: false, stickers: [stickerBox] });
    expect(result.stickersFilled).toBe(1);
    const after = await raw(result.data);
    const scale = after.w / 600;
    const [r, g, b] = pixel(after.data, after.w, Math.round(380 * scale), Math.round(112 * scale));
    expect(Math.abs(r - 150)).toBeLessThan(14);
    expect(Math.abs(g - 80)).toBeLessThan(14);
    expect(Math.abs(b - 170)).toBeLessThan(14);
  });
});

describe('helpers', () => {
  it('measures how green the border of a photo is', async () => {
    const green = await raw(await boxOnGreen());
    const plain = await raw(await boxOnGreen(false));
    expect(greenBorderShare(green.data, green.w, green.h)).toBeGreaterThan(0.9);
    expect(greenBorderShare(plain.data, plain.w, plain.h)).toBeLessThan(0.1);
  });

  it('ignores a region too large to be a sticker', async () => {
    const photo = await raw(await boxOnGreen());
    const copy = Buffer.from(photo.data);
    fillRegion(copy, photo.w, photo.h, { x: 0, y: 0, width: 1, height: 1 });
    expect(copy.equals(photo.data)).toBe(true);
  });
});
