import sharp from "sharp";

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
        fit: "contain",
        background: BACKGROUND,
      })
      .flatten({ background: BACKGROUND })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (error) {
    console.error("Error processing product photo, using original:", error);
    return buffer;
  }
}
