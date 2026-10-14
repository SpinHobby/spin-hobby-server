import { AppError } from '../../../common/errors.js';

/** What is done to every photo of a batch. Each step is on unless the admin turned it off; the cut-out onto white is the point of a batch and is always done. */
export interface PhotoJobOptions {
  /** `product` keeps the whole box (the safe choice for a batch); `character` cuts the figure out of a flat cover; `auto` picks. */
  mode: 'product' | 'character' | 'auto';
  /** Take the shop's own price stickers off the picture. */
  stickers: boolean;
  /** Make the picture bigger and sharper with the best model (slow: the point of leaving it overnight). */
  enlarge: boolean;
  /** The brighter, more lively look. */
  look: boolean;
}

export const DEFAULT_PHOTO_OPTIONS: PhotoJobOptions = {
  mode: 'product',
  stickers: true,
  enlarge: true,
  look: true,
};

const flag = (value: unknown, fallback: boolean, name: string): boolean => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new AppError(`${name} must be on or off.`);
  return value;
};

/** The options as sent, checked, with the defaults filled in. */
export function parsePhotoOptions(raw: unknown): PhotoJobOptions {
  if (raw === undefined || raw === null) return { ...DEFAULT_PHOTO_OPTIONS };
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError('The options are not readable.');
  const o = raw as Record<string, unknown>;
  const mode = o.mode ?? DEFAULT_PHOTO_OPTIONS.mode;
  if (mode !== 'product' && mode !== 'character' && mode !== 'auto')
    throw new AppError('mode must be product, character or auto.');
  return {
    mode,
    stickers: flag(o.stickers, true, 'stickers'),
    enlarge: flag(o.enlarge, true, 'enlarge'),
    look: flag(o.look, true, 'look'),
  };
}

/** What a worker says about a finished photo: only these, cut to size. */
export interface PhotoJobDetails {
  flags: string[];
  notes: string[];
  seconds: number | null;
  modeUsed: string | null;
}

const texts = (value: unknown, count: number, max: number): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, count)
        .map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, max))
        .filter(Boolean)
    : [];

export function parseJobDetails(raw: unknown): PhotoJobDetails {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const seconds = Number(o.seconds);
  return {
    flags: texts(o.flags, 20, 300),
    notes: texts(o.notes, 20, 300),
    seconds: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 10) / 10 : null,
    modeUsed: typeof o.modeUsed === 'string' ? o.modeUsed.slice(0, 20) : null,
  };
}
