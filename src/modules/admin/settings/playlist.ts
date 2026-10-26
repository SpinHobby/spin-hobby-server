import { AppError } from '../../../common/errors.js';

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * A YouTube playlist from what the owner pasted: the playlist's address (youtube.com/playlist?list=…, or a video address with
 * `list=`), or the id itself. Blank turns the Shop playlist off (null).
 */
export function playlistId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AppError('music_playlist_id must be text.');
  const text = value.trim();
  if (!text) return null;
  let id = text;
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new AppError("That isn't a YouTube playlist address.");
    }
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(url.hostname))
      throw new AppError('Use a YouTube playlist address (youtube.com/playlist?list=…).');
    id = url.searchParams.get('list') ?? '';
  }
  if (!PLAYLIST_ID.test(id))
    throw new AppError(
      "That isn't a YouTube playlist. Open the playlist on YouTube and copy its address.",
    );
  return id;
}
