import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MAX_PHOTO_SIDE,
  processEditedPhoto,
  processForSquare,
  processProductPhoto,
} from './image-processing.js';

/** A photo of a tall product: a coloured block on a plain off-white table, like a figure's photo from Gleamshelf. */
const tallPhoto = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 250, g: 250, b: 250 } } })
    .composite([
      {
        input: {
          create: {
            width: Math.round(width * 0.6),
            height: Math.round(height * 0.8),
            channels: 3,
            background: { r: 200, g: 40, b: 90 },
          },
        },
        left: Math.round(width * 0.2),
        top: Math.round(height * 0.1),
      },
    ])
    .jpeg()
    .toBuffer();

describe('product photos keep their resolution (spin-hobby#110)', () => {
  it('keeps a tall photo tall, not on a square, and big: the longest side up to MAX_PHOTO_SIDE', async () => {
    const out = await sharp(await processProductPhoto(await tallPhoto(3864, 4832))).metadata();
    // the plain edges are trimmed, so the product's own shape is left: about 0.6 x 0.8 of the photo, scaled to fit 3072
    expect(out.height).toBe(MAX_PHOTO_SIDE);
    expect(out.width).toBeGreaterThan(MAX_PHOTO_SIDE * 0.55);
    expect(out.width).toBeLessThan(MAX_PHOTO_SIDE * 0.65);
  });

  it('never enlarges a small photo', async () => {
    const out = await sharp(await processProductPhoto(await tallPhoto(500, 800))).metadata();
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(800);
  });

  it('keeps an edited photo up to MAX_PHOTO_SIDE (it was 1600), in its own shape', async () => {
    const edited = await processEditedPhoto(await tallPhoto(2400, 4000));
    const out = await sharp(edited.data).metadata();
    expect(out.height).toBe(MAX_PHOTO_SIDE);
    expect(out.width).toBe(Math.round((2400 / 4000) * MAX_PHOTO_SIDE));
  });

  it('sends Square a large JPEG for a finished photo', async () => {
    const sent = await processForSquare(await tallPhoto(3000, 4000));
    const out = await sharp(sent.data).metadata();
    expect(sent.contentType).toBe('image/jpeg');
    expect(Math.max(out.width, out.height)).toBeGreaterThan(2000);
  });
});
