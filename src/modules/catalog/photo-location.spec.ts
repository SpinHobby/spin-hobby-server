import { describe, expect, it } from 'vitest';
import { photoLocation, storagePathFromUrl } from './photo-location.js';

const SQUARE = 'https://items-images-production.s3.us-west-2.amazonaws.com/files/abc/original.jpeg';
const STORAGE =
  'https://proj.supabase.co/storage/v1/object/public/product-images/products/2026-10/a-b.webp';
const LOCAL = 'http://localhost:8080/uploads/products/2026-10/a-b.webp';

describe('photoLocation', () => {
  it('tells Square, our storage, outside and missing photos apart', () => {
    expect(photoLocation(SQUARE)).toBe('square');
    expect(
      photoLocation('https://items-images-sandbox.s3.us-west-2.amazonaws.com/files/x.jpg'),
    ).toBe('square');
    expect(photoLocation(STORAGE)).toBe('storage');
    expect(photoLocation(LOCAL)).toBe('storage');
    expect(photoLocation('https://example.com/sample.svg')).toBe('external');
    expect(photoLocation(null)).toBe('none');
    expect(photoLocation('')).toBe('none');
    expect(photoLocation(undefined)).toBe('none');
  });
});

describe('storagePathFromUrl', () => {
  it('returns the file path for our own storage and local uploads', () => {
    expect(storagePathFromUrl(STORAGE)).toBe('products/2026-10/a-b.webp');
    expect(storagePathFromUrl(`${STORAGE}?width=200`)).toBe('products/2026-10/a-b.webp');
    expect(storagePathFromUrl(LOCAL)).toBe('products/2026-10/a-b.webp');
  });

  it('never claims a file that is not ours (so it can never be deleted)', () => {
    expect(storagePathFromUrl(SQUARE)).toBeNull();
    expect(storagePathFromUrl('https://example.com/sample.svg')).toBeNull();
    expect(
      storagePathFromUrl('https://proj.supabase.co/storage/v1/object/public/other-bucket/x.png'),
    ).toBeNull();
    expect(storagePathFromUrl('http://localhost:8080/uploads/../../etc/passwd')).toBeNull();
  });
});
