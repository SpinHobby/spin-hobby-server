import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError } from '../../common/errors.js';
import { storagePathFromUrl } from '../../modules/catalog/photo-location.js';
import { isProduction, port, publicApiUrl } from '../../config/app.config.js';
import { supabaseServiceKey, supabaseUrl } from '../../config/supabase.config.js';
import { localUploadDir } from '../../config/storage.config.js';

export const IMAGE_BUCKET = 'product-images';
export const IMAGE_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * An image made smaller in bytes until it fits `limit` (the storage bucket's own limit too): first saved again more tightly at full size,
 * then a little smaller each time (85% of the width and height), keeping its type and transparency. Photos are kept up to 3072 px since
 * 2026-11-20 (spin-hobby#110), and a 3072 px cut-out on a transparent square can be a PNG over 5 MB: adding a product then failed with
 * "Images must be under 5 MB". Null when it cannot be read or still does not fit.
 */
export async function fitUnderLimit(
  bytes: Buffer,
  contentType: string,
  limit = MAX_IMAGE_BYTES,
): Promise<Buffer | null> {
  if (bytes.length <= limit) return bytes;
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    for (let step = 0; step < 10; step++) {
      const k = Math.pow(0.85, step);
      let image = sharp(bytes);
      if (step > 0)
        image = image.resize({
          width: Math.max(1, Math.round(meta.width * k)),
          height: Math.max(1, Math.round(meta.height * k)),
          fit: 'inside',
        });
      const out =
        contentType === 'image/png'
          ? await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
          : contentType === 'image/webp'
            ? await image.webp({ quality: 82 }).toBuffer()
            : await image.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      if (out.length <= limit) return out;
    }
  } catch {
    /* not an image sharp can read */
  }
  return null;
}

/** Writes admin-uploaded photos to the public Supabase Storage bucket (service role only). */
@Injectable()
export class StorageService {
  async uploadImage(
    bytes: Buffer,
    contentType: string,
    folder: 'products' | 'slides' | 'imports' | 'uploads' | 'backgrounds' | 'channels',
  ) {
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new AppError('Upload a WebP, JPEG or PNG image.');
    if (!bytes.length) throw new AppError('The image is empty.');
    // too big in bytes: made to fit rather than refused (most are photos the shop made itself, which nobody can shrink by hand)
    const fitted = await fitUnderLimit(bytes, contentType);
    if (!fitted) throw new AppError('Images must be under 5 MB.');
    bytes = fitted;
    const base = supabaseUrl();
    const key = supabaseServiceKey();
    const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
    if (!base || !key) {
      // Local development without Supabase: keep uploads on disk, served at /uploads (see setup.ts).
      if (!isProduction()) {
        const file = join(localUploadDir(), path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
        const origin = publicApiUrl() ?? `http://localhost:${port()}`;
        return { url: `${origin.replace(/\/$/, '')}/uploads/${path}`, path, bytes: bytes.length };
      }
      throw new AppError(
        'Image uploads are not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
        503,
      );
    }
    const res = await fetch(`${base}/storage/v1/object/${IMAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': contentType,
        'cache-control': '31536000',
        'x-upsert': 'false',
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new AppError(`Image upload failed (${res.status}).`, 502);
    return {
      url: `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`,
      path,
      bytes: bytes.length,
    };
  }

  /**
   * Deletes photos from our storage to free the space. Only files that are really ours are touched (addresses
   * that point elsewhere, such as Square's picture host, are ignored). Returns how many files were requested.
   */
  async deleteImages(urls: string[]): Promise<number> {
    const paths = [...new Set(urls.map(storagePathFromUrl).filter((p): p is string => p !== null))];
    if (!paths.length) return 0;
    const base = supabaseUrl();
    const key = supabaseServiceKey();
    if (!base || !key) {
      if (!isProduction()) {
        for (const path of paths) await rm(join(localUploadDir(), path), { force: true });
        return paths.length;
      }
      throw new AppError(
        'Image storage is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
        503,
      );
    }
    const res = await fetch(`${base}/storage/v1/object/${IMAGE_BUCKET}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new AppError(`Deleting photos failed (${res.status}).`, 502);
    return paths.length;
  }
}
