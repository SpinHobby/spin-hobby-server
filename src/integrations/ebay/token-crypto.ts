import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors.js';
import { ebayTokenKey } from '../../config/ebay.config.js';

/**
 * The seller's eBay tokens are kept encrypted (AES-256-GCM): whoever holds one can list, revise and end the shop's listings and read its
 * orders. The key comes from EBAY_TOKEN_KEY, so a copy of the database alone is not enough.
 */
const key = () => {
  const secret = ebayTokenKey();
  if (!secret)
    throw new AppError('eBay is not set up on the server (EBAY_TOKEN_KEY is missing).', 503);
  return createHash('sha256').update(secret).digest();
};

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    sealed.toString('base64'),
  ].join('.');
}

export function openToken(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data)
    throw new AppError('The stored eBay token is damaged: connect eBay again.', 409);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new AppError(
      'The stored eBay token cannot be read (EBAY_TOKEN_KEY changed?): connect eBay again.',
      409,
    );
  }
}
