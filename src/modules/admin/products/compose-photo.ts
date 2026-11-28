import sharp, { type OutputInfo, type Sharp } from 'sharp';
import { AppError } from '../../../common/errors.js';
import { MAX_PHOTO_SIDE } from '../../cashier/image-processing.js';
import { blendOnBackground } from './blend-photo.js';

/** The finished photo is a square this many pixels wide: the same as the longest side the shop keeps any photo at (MAX_PHOTO_SIDE), so a
 *  cut-out on the shop background is as sharp as the photo it came from (it was 1600: spin-hobby#110). */
export const PHOTO_SIZE = MAX_PHOTO_SIDE;
/** Space left around the product on each side, as a share of the square (the admin's preview uses the same). */
export const PHOTO_PADDING = 0.08;

/**
 * A product photo made from Gleamshelf's cut-out (the product alone on a transparent background): the product, scaled to fit inside the padding and
 * centred, with a soft shadow below it, on white; or blended into the shop's background (scaled to fill the square, cropped from the centre) the
 * way the website shows it (blend-photo.ts: standing low on the table, contact and cast shadows, light gently matched). The product's own pixels
 * are only scaled, placed and (on a background) gently tinted, never redrawn.
 */
export async function composeOnBackground(
  cutout: Buffer,
  background: Buffer | null,
  size = PHOTO_SIZE,
): Promise<Buffer> {
  return placeCutout(cutout, background, size, false);
}

/**
 * The product photo as the shop keeps it: the cut-out placed the same way (scaled into the padding, centred, with its soft shadow) on a transparent
 * square, as a PNG. Wherever it is shown, the shop's background shows through, so one setting changes the background of every such photo.
 */
export async function transparentPhoto(cutout: Buffer, size = PHOTO_SIZE): Promise<Buffer> {
  return placeCutout(cutout, null, size, true);
}

async function placeCutout(
  cutout: Buffer,
  background: Buffer | null,
  size: number,
  transparent: boolean,
): Promise<Buffer> {
  const inner = Math.round(size * (1 - 2 * PHOTO_PADDING));
  let product: { data: Buffer; info: OutputInfo };
  try {
    product = await sharp(cutout)
      .ensureAlpha()
      .trim({ threshold: 0 })
      .resize({ width: inner, height: inner, fit: 'inside' })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError('The cut-out of this photo could not be read.', 422);
  }
  const { width, height } = product.info;
  const left = Math.round((size - width) / 2);
  const top = Math.round((size - height) / 2);
  if (background && !transparent)
    return blendedOnBackground(product.data, left, top, background, size);

  // the shadow: the product's outline, faint and blurred, a little lower (as on Gleamshelf's own studio square)
  const blur = Math.max(2, Math.round(size / 80));
  const offset = Math.round(size / 100);
  const pad = blur * 3;
  // the outline is padded and faded here, not with sharp's own steps: those run in sharp's fixed order (the alpha would be taken out after the
  // border was added, so the border would be opaque)
  const alpha = await sharp(product.data).extractChannel('alpha').raw().toBuffer();
  const sw = width + 2 * pad;
  const sh = height + 2 * pad;
  const faded = Buffer.alloc(sw * sh);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      faded[(y + pad) * sw + x + pad] = Math.round(alpha[y * width + x] * 0.22);
  // (blurring gives back three channels even for one)
  const blurred = await sharp(faded, { raw: { width: sw, height: sh, channels: 1 } })
    .blur(blur)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = blurred.info.channels;
  // black pixels whose see-through-ness is the blurred outline
  const rgba = Buffer.alloc(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) rgba[i * 4 + 3] = blurred.data[i * stride]!;
  const shadow = await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } })
    .png()
    .toBuffer();

  let base: Sharp;
  if (transparent) {
    base = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
  } else if (background) {
    try {
      base = sharp(
        await sharp(background)
          .rotate()
          .resize(size, size, { fit: 'cover' })
          .flatten({ background: '#ffffff' })
          .toBuffer(),
      );
    } catch {
      throw new AppError('The background picture could not be read.', 422);
    }
  } else {
    base = sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } });
  }
  const placed = base.composite([
    { input: shadow, left: left - pad, top: top - pad + offset },
    { input: product.data, left, top },
  ]);
  return transparent ? placed.png().toBuffer() : placed.jpeg({ quality: 92 }).toBuffer();
}

/**
 * The product blended into a background, as the website shows it (blend-photo.ts): standing low on the table with a contact and a cast shadow, its
 * light matched to the background, no outline shadow.
 */
async function blendedOnBackground(
  product: Buffer,
  left: number,
  top: number,
  background: Buffer,
  size: number,
): Promise<Buffer> {
  const square = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: product, left, top }])
    .raw()
    .toBuffer();
  let back: Buffer;
  try {
    back = await sharp(background)
      .rotate()
      .resize(size, size, { fit: 'cover' })
      .flatten({ background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer();
  } catch {
    throw new AppError('The background picture could not be read.', 422);
  }
  const pixels = (b: Buffer) => ({ w: size, h: size, d: new Uint8ClampedArray(b) });
  const out = blendOnBackground(pixels(square), pixels(back));
  if (!out)
    return sharp(back, { raw: { width: size, height: size, channels: 4 } })
      .jpeg({ quality: 92 })
      .toBuffer();
  return sharp(Buffer.from(out.d.buffer), { raw: { width: size, height: size, channels: 4 } })
    .removeAlpha()
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Whether a picture has see-through pixels: a cut-out must (a photo on its white square is not one). */
export async function hasTransparency(bytes: Buffer): Promise<boolean> {
  try {
    const image = sharp(bytes);
    const { hasAlpha } = await image.metadata();
    return !!hasAlpha && !(await image.stats()).isOpaque;
  } catch {
    return false;
  }
}

/**
 * The photo as it was taken, cropped to the product with a little room around it: no AI, no repainting, nothing taken off. `rect` is where the
 * product is, as fractions of the (upright) photo; `margin` is added on each side as a fraction of the product's own size.
 */
export async function cropToProduct(
  photo: Buffer,
  rect: { x: number; y: number; width: number; height: number },
  margin = 0.04,
): Promise<Buffer> {
  const upright = await sharp(photo).rotate().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = upright.info;
  const left = Math.max(0, Math.floor((rect.x - rect.width * margin) * W));
  const top = Math.max(0, Math.floor((rect.y - rect.height * margin) * H));
  const right = Math.min(W, Math.ceil((rect.x + rect.width * (1 + margin)) * W));
  const bottom = Math.min(H, Math.ceil((rect.y + rect.height * (1 + margin)) * H));
  if (right - left < 16 || bottom - top < 16)
    throw new AppError('The product is too small in this photo to crop.', 422);
  return sharp(upright.data)
    .extract({ left, top, width: right - left, height: bottom - top })
    .jpeg({ quality: 92 })
    .toBuffer();
}
