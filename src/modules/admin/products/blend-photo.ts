/*
 * The same blend as the website's (spin-hobby src/v3/blend/blendCore.ts): keep the two in step, so a listing photo made here (eBay, feeds)
 * looks like the product page.
 */
/**
 * A transparent product photo blended into the shop background, so the product stands in the scene instead of looking pasted on top:
 *  - the faint outline shadow baked into the transparent photo (a sticker's shadow, all round the product) is taken out;
 *  - the product is moved down so it stands low on the table (never up, never cropped);
 *  - a contact shadow is laid on the background where the product touches it: tight and dark at the touch, wide and faint round that
 *    (the same recipe as Gleamshelf's promo pictures, packages/pipeline/src/promo.ts);
 *  - the product's colours lean gently towards the background's light (a little warmer in a warm room, a little dimmer in a dim one);
 *  - a thin glow of the background's colour is mixed into the product's very edge, which softens the cut line.
 * The product's own pixels are only tinted and edge-mixed, never redrawn. Pure: pixels in, pixels out.
 */

/** RGBA pixels, straight (not premultiplied) alpha, like ImageData. */
export interface Rgba {
  w: number;
  h: number;
  d: Uint8ClampedArray<ArrayBuffer>;
}

/** Where the product's base is placed (share of the square, from the top): low on the table, like a padded photo on a studio sweep. */
export const BASE_AT = 0.88;
/** The least room kept above the product when it is moved down. */
const TOP_ROOM = 0.05;
/** The see-through-ness and darkness under which a pixel is the baked outline shadow (black, at most 22% opaque) rather than the product. */
const BAKED_SHADOW_ALPHA = 64;
const BAKED_SHADOW_DARK = 12;
/** The cast shadow behind the product: its length (share of the product's height), its lean, and how dark it is where it starts. */
const CAST_LENGTH = 0.22;
const CAST_SKEW = 0.12;
const CAST_DARKNESS = 0.3;
/** The share of the product's height (from its base) that casts that shadow. */
const CAST_FROM = 0.45;
/** How far above the lowest point (share of the square) a part still touches the table: more is a raised foot or an arm, with no contact shadow. */
const TOUCH = 0.025;

/** A Gaussian-like blur of one channel (three box blurs), sigma in pixels. */
export function blur1(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.5) return src.slice();
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const a = src.slice();
  const b = new Float32Array(src.length);
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wl + 2) - 1) / 2;
    box(a, b, w, h, r, true);
    box(b, a, w, h, r, false);
  }
  return a;
}

function box(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const scale = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * w : line;
    const at = (k: number) => src[start + (k < 0 ? 0 : k >= len ? len - 1 : k) * step];
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += at(k);
    for (let k = 0; k < len; k++) {
      dst[start + k * step] = acc * scale;
      acc += at(k + r + 1) - at(k - r);
    }
  }
}

/** The background's light: its mean colour and how bright it is (0-1). */
export function lightOf(bg: Rgba): { mean: [number, number, number]; lum: number } {
  const s = [0, 0, 0];
  const d = bg.d;
  // every 4th pixel is plenty
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    s[0] += d[i];
    s[1] += d[i + 1];
    s[2] += d[i + 2];
    n++;
  }
  const mean: [number, number, number] = [s[0] / n, s[1] / n, s[2] / n];
  return { mean, lum: (0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2]) / 255 };
}

/** How the product's colours are leaned towards the background's light: a gain per channel, all within a few percent of 1. */
export function tintFor(light: {
  mean: [number, number, number];
  lum: number;
}): [number, number, number] {
  const lum255 = Math.max(1, light.lum * 255);
  const bright = Math.min(1.02, Math.max(0.9, 1 + 0.3 * (light.lum - 0.62)));
  return light.mean.map((c) => {
    const cast = Math.min(1.15, Math.max(0.85, c / lum255));
    return (1 + 0.15 * (cast - 1)) * bright;
  }) as [number, number, number];
}

/**
 * The product photo `cut` (a transparent square, the product padded and centred) blended into `bg` (the same size, already cropped to
 * the square). Null when the photo has no product in it.
 */
export function blendOnBackground(cut: Rgba, bg: Rgba): Rgba | null {
  const N = cut.w;
  const H = cut.h;
  const n = N * H;
  const k = N / 2000;
  const cd = cut.d;

  // the product's see-through-ness, without the baked outline shadow
  const alpha = new Float32Array(n);
  let top = H;
  let bottom = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = cd[o + 3];
    if (
      a <= BAKED_SHADOW_ALPHA &&
      cd[o] <= BAKED_SHADOW_DARK &&
      cd[o + 1] <= BAKED_SHADOW_DARK &&
      cd[o + 2] <= BAKED_SHADOW_DARK
    )
      a = 0;
    alpha[i] = a / 255;
    if (a > 128) {
      const y = (i / N) | 0;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (bottom < 0) return null;

  // moved down so it stands low on the table
  const dy = Math.max(0, Math.round(Math.min(BASE_AT * H - bottom, top - TOP_ROOM * H)));
  const A = new Float32Array(n);
  A.set(alpha.subarray(0, n - dy * N), dy * N);
  const src = (i: number) => (i - dy * N) * 4; // where a placed pixel comes from in `cut`
  bottom += dy;

  // the background, as floats
  const B = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) B[c][i] = bg.d[i * 4 + c];

  // where each column of the product meets the table; only columns near the lowest point touch it (an outstretched arm does not)
  const foot = new Int32Array(N).fill(-1);
  const reach = Math.max(2, Math.round(TOUCH * H));
  for (let x = 0; x < N; x++)
    for (let y = H - 1; y >= 0; y--)
      if (A[y * N + x] > 0.5) {
        if (y >= bottom - reach) foot[x] = y;
        break;
      }
  const line = (above: number, below: number) => {
    const g = new Float32Array(n);
    for (let x = 0; x < N; x++) {
      if (foot[x] < 0) continue;
      for (let d = -above; d <= below; d++) {
        const y = foot[x] + d;
        if (y >= 0 && y < H) g[y * N + x] = 1;
      }
    }
    return g;
  };
  const near = blur1(
    line(Math.round(4 * k), Math.max(1, Math.round(10 * k))),
    N,
    H,
    Math.max(1, 12 * k),
  );
  const far = blur1(
    line(Math.round(10 * k), Math.max(2, Math.round(50 * k))),
    N,
    H,
    Math.max(1.5, 70 * k),
  );
  // the cast shadow: the product's outline laid back across the table behind it (light from the front, a little from the left),
  // short and fading with height, blurred more than the contact shadow
  // only from the lower part of the product, and only above where it stands: a sleeve or a robe held out to the side is up in the
  // air, and laying its shadow on the table beside it looked like the shadow of a raised foot (Nezuko, 2026-11-27)
  const cast = new Float32Array(n);
  const tall = Math.max(1, bottom - (top + dy)); // the product's height, as placed
  let footLeft = N;
  let footRight = -1;
  for (let x = 0; x < N; x++)
    if (foot[x] >= 0) {
      footLeft = Math.min(footLeft, x);
      footRight = Math.max(footRight, x);
    }
  const margin = Math.round(0.03 * N);
  const lower = tall * CAST_FROM;
  for (let y = Math.max(0, Math.round(bottom - lower)); y <= bottom; y++)
    for (let x = Math.max(0, footLeft - margin); x <= Math.min(N - 1, footRight + margin); x++) {
      if (A[y * N + x] <= 0.5) continue;
      const d = bottom - y;
      const py = Math.round(bottom - d * CAST_LENGTH);
      const px = Math.round(x + d * CAST_SKEW);
      if (px < 0 || px >= N || py < 0) continue;
      const fade = (1 - d / lower) ** 1.5;
      const j = py * N + px;
      if (fade > cast[j]) cast[j] = fade;
    }
  const castSoft = blur1(cast, N, H, Math.max(1.5, 16 * k));
  for (let i = 0; i < n; i++) {
    const shade =
      (1 - Math.min(1, near[i] * 0.7 + far[i] * 0.4)) *
      (1 - CAST_DARKNESS * Math.min(1, castSoft[i]));
    if (shade < 1) for (let c = 0; c < 3; c++) B[c][i] *= shade;
  }

  // the edge glow: how near a product pixel is to its outline, and the background's colour round it
  const edge = blur1(A, N, H, Math.max(1, 4 * k));
  const soft = B.map((ch) => blur1(ch, N, H, Math.max(2, 12 * k)));
  const gain = tintFor(lightOf(bg));

  const out: Rgba = { w: N, h: H, d: new Uint8ClampedArray(n * 4) };
  for (let i = 0; i < n; i++) {
    const a = A[i];
    const o = i * 4;
    if (a <= 0) {
      for (let c = 0; c < 3; c++) out.d[o + c] = B[c][i];
    } else {
      const s = src(i);
      const wrap = Math.min(1, Math.max(0, a - edge[i]) * 1.6) * 0.45;
      for (let c = 0; c < 3; c++) {
        let p = cd[s + c] * gain[c];
        p += (soft[c][i] - p) * wrap;
        out.d[o + c] = B[c][i] * (1 - a) + p * a;
      }
    }
    out.d[o + 3] = 255;
  }
  return out;
}
