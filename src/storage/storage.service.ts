import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';

export const IMAGE_BUCKET = 'product-images';
export const IMAGE_TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Writes admin-uploaded photos to the public Supabase Storage bucket (service role only). */
@Injectable()
export class StorageService {
  async uploadImage(bytes: Buffer, contentType: string, folder: 'products' | 'slides') {
    const ext = IMAGE_TYPES[contentType];
    if (!ext) throw new AppError('Upload a WebP, JPEG or PNG image.');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new AppError('Images must be under 5 MB.');
    const base = env('SUPABASE_URL')?.replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
    if (!base || !key) throw new AppError('Image uploads are not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).', 503);
    const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
    const res = await fetch(`${base}/storage/v1/object/${IMAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': contentType, 'cache-control': '31536000', 'x-upsert': 'false' },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new AppError(`Image upload failed (${res.status}).`, 502);
    return { url: `${base}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`, path, bytes: bytes.length };
  }
}
