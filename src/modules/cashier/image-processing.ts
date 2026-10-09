import { Logger } from '@nestjs/common';
import sharp from 'sharp';

const logger = new Logger('ImageProcessing');
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const CANVAS_SIZE = 1200;
// Matches the storefront's off-white page background ($neutral-50) so product
// photos blend into the page instead of showing a hard white/gray box edge.
const BACKGROUND = { r: 250, g: 250, b: 250, alpha: 1 };

// Cleans up a cashier-captured photo for the storefront: auto-orients from
// EXIF, trims uniform-color table/background edges where present, and
// composites onto a consistent square canvas so cards look uniform instead
// of like random phone snapshots of wildly different sizes and crops. This
// only reframes the photo - it never alters the item itself, so it stays
// accurate to what actually ships.
//
// Deliberately does NOT auto-adjust brightness/contrast: sharp's normalize()
// was tried and rejected here - on photos with any real lighting gradient
// (i.e. most phone photos under directional light, not a lightbox) it
// crushes shadows toward black rather than helping, which looked worse than
// the original. A real lighting fix needs proper white-balance/exposure
// logic, not a blind histogram stretch - not worth the risk for now.
export interface ArtworkCrop {
  x: number; // fraction of width, 0-1
  y: number; // fraction of height, 0-1
  width: number; // fraction of width, 0-1
  height: number; // fraction of height, 0-1
  rotationDegrees: number; // clockwise, to straighten after cropping
}

// Extracts a sub-region of a photo (the AI-located artwork panel on a sealed
// box, e.g.) and straightens it. Crops BEFORE rotating - the box coordinates
// come from the model looking at the original, unrotated photo, so cropping
// first with a small margin (already baked into the coordinates upstream)
// keeps the panel fully inside the frame even after the straightening
// rotation nudges it. Falls back to the original buffer on any failure,
// matching processProductPhoto's philosophy of never failing the whole save
// over a best-effort cleanup step.
export async function cropToArtworkRegion(buffer: Buffer, crop: ArtworkCrop): Promise<Buffer> {
  try {
    const oriented = sharp(buffer).rotate();
    const meta = await oriented.metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) return buffer;

    const left = Math.round(crop.x * width);
    const top = Math.round(crop.y * height);
    const extractWidth = Math.max(1, Math.min(width - left, Math.round(crop.width * width)));
    const extractHeight = Math.max(1, Math.min(height - top, Math.round(crop.height * height)));

    let working = sharp(await oriented.toBuffer()).extract({
      left,
      top,
      width: extractWidth,
      height: extractHeight,
    });

    if (Math.abs(crop.rotationDegrees) >= 0.5) {
      working = sharp(await working.toBuffer()).rotate(crop.rotationDegrees, {
        background: BACKGROUND,
      });
    }

    return await working.toBuffer();
  } catch (error) {
    logger.error(`Error cropping artwork region, using original photo: ${errorText(error)}`);
    return buffer;
  }
}

export async function processProductPhoto(buffer: Buffer): Promise<Buffer> {
  try {
    let working = sharp(buffer).rotate();
    try {
      working = sharp(await working.trim({ threshold: 24 }).toBuffer()).rotate();
    } catch {
      // Trim can fail on near-uniform or already-tightly-cropped photos -
      // fall back to the oriented original rather than failing the save.
    }

    return await working
      .resize({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        fit: 'contain',
        background: BACKGROUND,
      })
      .flatten({ background: BACKGROUND })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (error) {
    logger.error(`Error processing product photo, using original: ${errorText(error)}`);
    return buffer;
  }
}

/**
 * Prepares a photo the admin edited for Square: upright, at most 1600 px on the long side, nothing cropped or
 * recoloured (the admin already framed it). A picture with a transparent background stays a PNG; anything else
 * becomes a high-quality JPEG. Falls back to the original bytes if it cannot be read.
 */
export async function processEditedPhoto(
  buffer: Buffer,
): Promise<{ data: Buffer; contentType: string }> {
  try {
    const image = sharp(buffer).rotate();
    const { hasAlpha } = await image.metadata();
    const resized = image.resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    });
    if (hasAlpha && !(await sharp(buffer).stats()).isOpaque)
      return { data: await resized.png().toBuffer(), contentType: 'image/png' };
    return {
      data: await resized.flatten({ background: BACKGROUND }).jpeg({ quality: 92 }).toBuffer(),
      contentType: 'image/jpeg',
    };
  } catch (error) {
    logger.error(`Error processing edited photo, using original: ${errorText(error)}`);
    return { data: buffer, contentType: 'image/jpeg' };
  }
}
