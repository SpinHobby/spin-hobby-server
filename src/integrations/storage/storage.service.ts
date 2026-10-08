import { Injectable } from '@nestjs/common';
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

/** Writes admin-uploaded photos to the public Supabase Storage bucket (service role only). */
@Injectable()
export class StorageService {
  async uploadImage(bytes: Buffer, contentType: string, folder: 'products' | 'slides') {
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new AppError('Upload a WebP, JPEG or PNG image.');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
      throw new AppError('Images must be under 5 MB.');
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
