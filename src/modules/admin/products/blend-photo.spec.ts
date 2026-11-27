import { describe, expect, it } from 'vitest';
import { BASE_AT, blendOnBackground, tintFor, type Rgba } from './blend-photo.js';

const N = 200;
const square = (fill: (x: number, y: number) => [number, number, number, number]): Rgba => {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d.set(fill(x, y), (y * N + x) * 4);
  return { w: N, h: N, d };
};
const plain = () => square(() => [180, 180, 180, 255]);
/** The lowest row with the product's own colour (red) in it. */
const baseOf = (img: Rgba) => {
  for (let y = N - 1; y >= 0; y--)
    for (let x = 0; x < N; x++)
      if (img.d[(y * N + x) * 4] > 200 && img.d[(y * N + x) * 4 + 1] < 60) return y;
  return -1;
};

describe('blendOnBackground', () => {
  it('moves a short product down to stand low, never up, never cropped', () => {
    const short = square((x, y) =>
      x > 60 && x < 140 && y > 80 && y < 120 ? [240, 20, 20, 255] : [0, 0, 0, 0],
    );
    expect(baseOf(blendOnBackground(short, plain())!)).toBe(Math.round(BASE_AT * N));
    const tall = square((x, y) =>
      x > 80 && x < 120 && y > 16 && y < 190 ? [240, 20, 20, 255] : [0, 0, 0, 0],
    );
    expect(baseOf(blendOnBackground(tall, plain())!)).toBe(189);
  });

  it('takes out the faint black outline shadow baked round a transparent photo', () => {
    const cut = square((x, y) => {
      if (x > 80 && x < 120 && y > 60 && y < 176) return [240, 20, 20, 255];
      if (x > 70 && x < 130 && y > 50 && y < 186) return [0, 0, 0, 40]; // the baked outline
      return [0, 0, 0, 0];
    });
    const out = blendOnBackground(cut, plain())!;
    // beside the product, level with its top: the background untouched
    expect(out.d[(70 * N + 74) * 4]).toBe(180);
  });

  it('gives nothing for a photo with no product in it', () => {
    expect(
      blendOnBackground(
        square(() => [0, 0, 0, 0]),
        plain(),
      ),
    ).toBeNull();
  });

  it('leans the product only a little towards the light', () => {
    for (const g of tintFor({ mean: [250, 120, 40], lum: 0.55 }))
      expect(Math.abs(g - 1)).toBeLessThan(0.1);
    const warm = tintFor({ mean: [200, 160, 120], lum: 0.65 });
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });
});
