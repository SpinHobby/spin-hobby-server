import sharp, { type OutputInfo, type Sharp } from 'sharp';
import { AppError } from '../../../common/errors.js';

/** The finished photo is a square this many pixels wide (what Square gets for an edited photo anyway). */
export const PHOTO_SIZE = 1600;
/** Space left around the product on each side, as a share of the square (the admin's preview uses the same). */
export const PHOTO_PADDING = 0.08;

/**
 * A product photo made from Gleamshelf's cut-out (the product alone on a transparent background): the product, scaled to fit inside the padding and
 * centred, with a soft shadow below it, on the shop's background (scaled to fill the square, cropped from the centre) or on white. The product's
 * own pixels are never changed: they are only scaled and placed.
 */
export async function composeOnBackground(
  cutout: Buffer,
  background: Buffer | null,
  size = PHOTO_SIZE,
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
  if (background) {
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
  return base
    .composite([
      { input: shadow, left: left - pad, top: top - pad + offset },
      { input: product.data, left, top },
    ])
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
