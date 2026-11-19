import { describe, expect, it } from 'vitest';
import { DEFAULT_POLISH, parsePhotoOptions } from './photo-job-options.js';

describe('parsePhotoOptions: the clean photo polish', () => {
  it('fills in the polish defaults: box art around a printed character, text off, box-art backdrop, maker photos', () => {
    expect(parsePhotoOptions({ clean: true }).polish).toEqual(DEFAULT_POLISH);
    expect(parsePhotoOptions(undefined).polish).toEqual({
      printed: 'boxart',
      removeText: true,
      backdrop: 'artwork',
      makerPhotos: true,
    });
  });

  it('reads options saved before the polish existed as the defaults', () => {
    const saved = {
      mode: 'product',
      stickers: true,
      enlarge: true,
      look: true,
      clean: true,
      official: true,
    };
    expect(parsePhotoOptions(saved).polish).toEqual(DEFAULT_POLISH);
  });

  it('keeps what the admin chose', () => {
    const polish = { printed: 'figure', removeText: false, backdrop: 'dark', makerPhotos: false };
    expect(parsePhotoOptions({ polish }).polish).toEqual(polish);
  });

  it('refuses anything else', () => {
    expect(() => parsePhotoOptions({ polish: { printed: 'window' } })).toThrow(
      /polish.printed must be boxart or figure/,
    );
    expect(() => parsePhotoOptions({ polish: { backdrop: 'green' } })).toThrow(/polish.backdrop/);
    expect(() => parsePhotoOptions({ polish: { removeText: 'yes' } })).toThrow(/polish.removeText/);
    expect(() => parsePhotoOptions({ polish: [] })).toThrow(/not readable/);
  });
});
