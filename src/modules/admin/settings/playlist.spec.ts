import { describe, expect, it } from 'vitest';
import { playlistId } from './playlist.js';

const ID = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

describe('playlistId', () => {
  it('takes the id from a playlist address, a video address in a playlist, or the id itself', () => {
    expect(playlistId(`https://www.youtube.com/playlist?list=${ID}`)).toBe(ID);
    expect(playlistId(`https://youtube.com/watch?v=dQw4w9WgXcQ&list=${ID}&index=3`)).toBe(ID);
    expect(playlistId(`https://music.youtube.com/playlist?list=${ID}`)).toBe(ID);
    expect(playlistId(`  ${ID} `)).toBe(ID);
  });

  it('turns the playlist off when blank', () => {
    expect(playlistId('')).toBeNull();
    expect(playlistId('   ')).toBeNull();
    expect(playlistId(null)).toBeNull();
  });

  it('refuses anything that is not a YouTube playlist', () => {
    expect(() => playlistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toThrow(
      /isn't a YouTube playlist/,
    );
    expect(() => playlistId(`https://evil.example.com/playlist?list=${ID}`)).toThrow(
      /YouTube playlist address/,
    );
    expect(() => playlistId('<script>')).toThrow();
    expect(() => playlistId(42)).toThrow();
  });
});
