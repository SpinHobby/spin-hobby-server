/**
 * Where a product photo is kept, worked out from its address:
 *  - `square`   Square's own picture host (the photo is stored in Square)
 *  - `storage`  our own storage (Supabase Storage in production, the local uploads folder in development)
 *  - `external` anywhere else (for example the sample pictures)
 *  - `none`     the product has no photo
 */
export type PhotoLocation = 'square' | 'storage' | 'external' | 'none';

const SQUARE_PHOTOS = /^https:\/\/items-images-[a-z]+\.s3\.[a-z0-9-]+\.amazonaws\.com\//;
/** The public address of a file in our storage bucket, or of a local development upload. */
const OUR_STORAGE = /\/storage\/v1\/object\/public\/product-images\/|\/uploads\//;

export function photoLocation(url: string | null | undefined): PhotoLocation {
  if (!url) return 'none';
  if (SQUARE_PHOTOS.test(url)) return 'square';
  if (OUR_STORAGE.test(url)) return 'storage';
  return 'external';
}

/**
 * The path of a file inside our storage bucket (`products/2026-10/abc.webp`), or null when the address is
 * not one of our own files. Only our own files are ever deleted.
 */
export function storagePathFromUrl(url: string): string | null {
  const found =
    url.match(/\/storage\/v1\/object\/public\/product-images\/(.+?)(?:\?.*)?$/) ??
    url.match(/\/uploads\/(.+?)(?:\?.*)?$/);
  if (!found) return null;
  const path = decodeURIComponent(found[1]);
  return path.split('/').includes('..') ? null : path; // never let a crafted address leave the folder
}
