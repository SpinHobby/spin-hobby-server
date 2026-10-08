import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service.js';

const SAVED = { ...process.env };
const fetchMock = vi.fn();
const OURS = (path: string) =>
  `https://proj.supabase.co/storage/v1/object/public/product-images/${path}`;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED };
});

describe('StorageService.deleteImages', () => {
  const storage = new StorageService();

  it('deletes only our own files, once each, in one request', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    const count = await storage.deleteImages([
      OURS('products/2026-10/a.webp'),
      OURS('products/2026-10/a.webp'), // the same file twice
      OURS('slides/2026-10/b.webp'),
      'https://items-images-production.s3.us-west-2.amazonaws.com/files/x.jpg', // Square's, never touched
      'https://example.com/sample.svg',
    ]);
    expect(count).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/storage/v1/object/product-images');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer service-key');
    expect(JSON.parse(init.body)).toEqual({
      prefixes: ['products/2026-10/a.webp', 'slides/2026-10/b.webp'],
    });
  });

  it('does nothing (and makes no request) when none of the photos are ours', async () => {
    expect(await storage.deleteImages(['https://example.com/x.png'])).toBe(0);
    expect(await storage.deleteImages([])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a storage failure instead of pretending the space was freed', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 500 }));
    await expect(storage.deleteImages([OURS('products/a.webp')])).rejects.toMatchObject({
      message: 'Deleting photos failed (500).',
      status: 502,
    });
  });
});
