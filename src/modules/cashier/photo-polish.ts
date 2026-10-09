import sharp from 'sharp';

/** A rectangle as fractions (0-1) of the photo's width and height, measured from the top-left corner. */
export interface StickerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolishOptions {
  /** Cut the product out of a plain green backdrop (a free image step; skipped if the photo has no green backdrop). */
  removeBackground: boolean;
  /** Shop stickers to paint over, found earlier (by the AI, or by hand). */
  stickers: StickerBox[];
}

export interface PolishResult {
  data: Buffer;
  contentType: 'image/png';
  /** Whether a green backdrop was found and removed (the PNG then has a transparent background). */
  backgroundRemoved: boolean;
  stickersFilled: number;
}

const WORK_SIZE = 1800;
const OUTPUT_SIZE = 1500;

/** The share of the photo's border that is green: a photo shot on a green backdrop has a green frame all round. */
export function greenBorderShare(rgba: Buffer, w: number, h: number): number {
  const ring = Math.max(4, Math.round(Math.min(w, h) * 0.02));
  let green = 0;
  let total = 0;
  const check = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const dom = rgba[i + 1] - Math.max(rgba[i], rgba[i + 2]);
    total++;
    if (dom > 12 && dom / Math.max(rgba[i + 1], 1) > 0.2) green++;
  };
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < ring; x += 2) {
      check(x, y);
      check(w - 1 - x, y);
    }
  }
  for (let x = 0; x < w; x += 3) {
    for (let y = 0; y < ring; y += 2) {
      check(x, y);
      check(x, h - 1 - y);
    }
  }
  return total ? green / total : 0;
}

/**
 * Paints a rectangle over from the pixels around it (each colour channel is smoothed in from the border), so a
 * shop sticker disappears into the artwork. Works well on soft or gradient artwork; it cannot invent detail.
 */
export function fillRegion(rgba: Buffer, w: number, h: number, box: StickerBox): void {
  // A little extra room around the sticker, more below it (a sticker's lower edge is the part most often missed).
  const x0 = Math.max(1, Math.floor((box.x - 0.008) * w));
  const y0 = Math.max(1, Math.floor((box.y - 0.01) * h));
  const x1 = Math.min(w - 2, Math.ceil((box.x + box.width + 0.008) * w));
  const y1 = Math.min(h - 2, Math.ceil((box.y + box.height + 0.022) * h));
  const rw = x1 - x0 + 1;
  const rh = y1 - y0 + 1;
  if (rw < 2 || rh < 2 || rw * rh > w * h * 0.08) return; // nothing sensible to fill, or far too big to be a sticker
  const px = (x: number, y: number, c: number) => rgba[(y * w + x) * 4 + c];
  for (let c = 0; c < 3; c++) {
    const v = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const t = y / Math.max(rh - 1, 1);
        const s = x / Math.max(rw - 1, 1);
        const vertical = px(x0 + x, y0 - 1, c) * (1 - t) + px(x0 + x, y1 + 1, c) * t;
        const horizontal = px(x0 - 1, y0 + y, c) * (1 - s) + px(x1 + 1, y0 + y, c) * s;
        v[y * rw + x] = (vertical + horizontal) / 2;
      }
    }
    for (let pass = 0; pass < 500; pass++) {
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const up = y === 0 ? px(x0 + x, y0 - 1, c) : v[(y - 1) * rw + x];
          const down = y === rh - 1 ? px(x0 + x, y1 + 1, c) : v[(y + 1) * rw + x];
          const left = x === 0 ? px(x0 - 1, y0 + y, c) : v[y * rw + x - 1];
          const right = x === rw - 1 ? px(x1 + 1, y0 + y, c) : v[y * rw + x + 1];
          v[y * rw + x] = (up + down + left + right) / 4;
        }
      }
    }
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        // A touch of grain so the filled patch does not look unnaturally smooth next to the printed artwork.
        const value = v[y * rw + x] + ((x * 7 + y * 13 + c * 5) % 5) - 2;
        rgba[((y0 + y) * w + x0 + x) * 4 + c] = Math.max(0, Math.min(255, value));
      }
    }
  }
}

/** Alpha from how green each pixel is relative to its brightness (so a shadowed backdrop counts too); spill removed. */
export function keyOutGreen(rgba: Buffer, w: number, h: number): void {
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const dom = g - Math.max(r, b);
    const ratio = dom / Math.max(g, 1);
    const a = dom <= 6 ? 1 : ratio >= 0.42 ? 0 : ratio <= 0.16 ? 1 : 1 - (ratio - 0.16) / 0.26;
    if (dom > 0 && a > 0) rgba[i * 4 + 1] = Math.min(255, Math.max(r, b) + dom * 0.15); // pull stray green back
    alpha[i] = Math.round(a * 255);
  }
  // Shrink the edge by one pixel so no green fringe is left.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          m = Math.min(m, alpha[yy * w + xx]);
        }
      }
      rgba[(y * w + x) * 4 + 3] = m;
    }
  }
}

/**
 * The product photo, tidied: upright, shop stickers painted over, the green backdrop removed (when there is
 * one) and cropped to the product, as a PNG. Nothing here costs anything; finding the stickers is the only
 * step that may use the AI, and it is done before this.
 */
export async function polishPhoto(input: Buffer, options: PolishOptions): Promise<PolishResult> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: WORK_SIZE, height: WORK_SIZE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rgba = Buffer.from(data);

  for (const box of options.stickers) fillRegion(rgba, w, h, box);

  const backgroundRemoved = options.removeBackground && greenBorderShare(rgba, w, h) > 0.5;
  if (backgroundRemoved) keyOutGreen(rgba, w, h);

  let image = sharp(rgba, { raw: { width: w, height: h, channels: 4 } });
  if (backgroundRemoved) {
    image = sharp(await image.blur(0.5).png().toBuffer());
    const trimmed = await image
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 12 })
      .toBuffer({ resolveWithObject: true });
    const pad = Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.03);
    image = sharp(trimmed.data).extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  const png = await image
    .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    data: png,
    contentType: 'image/png',
    backgroundRemoved,
    stickersFilled: options.stickers.length,
  };
}
