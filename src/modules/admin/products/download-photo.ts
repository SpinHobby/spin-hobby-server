import { AppError } from '../../../common/errors.js';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Reads one of our stored photos back (to hand it to Square). */
export async function downloadPhoto(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) throw new AppError('One of the photos could not be read from our storage.', 502);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    throw new AppError('One of the photos has an unexpected size.', 502);
  return bytes;
}
