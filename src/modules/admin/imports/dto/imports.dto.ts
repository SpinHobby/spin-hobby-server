import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';

/** A Gleamshelf app trading the code shown in the admin for its token. */
export class PairDto {
  @Text('code', 20)
  code!: string;

  /** What to call this connection in the admin (the computer's name). */
  @OptionalText(80)
  label: string | null = null;
}

/** A draft listing and its photo, sent by a connected app: the draft is JSON in a text field next to the photo file. */
export class ReceiveDraftDto {
  @Rule((value) => {
    // a rule runs twice (clean, then check): the second time the text is already the parsed draft
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value.trim() || value.length > 40_000)
      throw new AppError('The draft is missing or too long.');
    try {
      return JSON.parse(value);
    } catch {
      throw new AppError('The draft is not valid JSON.');
    }
  })
  draft!: unknown;
}

export class RejectImportDto {
  @OptionalText(300)
  reason: string | null = null;
}

export class ImportsQuery {
  @Rule((v) => (v === 'added' || v === 'rejected' ? v : 'draft'))
  status: 'draft' | 'added' | 'rejected' = 'draft';
}

const idList = (field: string, max: number) => (value: unknown) => {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    value.some((x) => typeof x !== 'string' || !x.trim() || x.length > 64)
  )
    throw new AppError(`${field} must be a list of 1 to ${max} items.`);
  return [...new Set(value.map((x: string) => x.trim()))];
};

/** Photos to improve: some products, and whether to take just each one's main photo or all of its photos. */
export class CreatePhotoBatchDto {
  @Rule(idList('productIds', 100))
  productIds!: string[];

  @Rule((v) => (v === 'all' ? 'all' : 'main'))
  scope: 'main' | 'all' = 'main';

  /** Which steps to do (see photo-job-options.ts); anything left out is on. */
  @Rule((v) => v ?? null)
  options: unknown = null;
}

/** The finished photos to use: the ones named, or every finished photo of the batch when none are named. */
export class ApplyPhotosDto {
  @Rule((v) => (v == null ? null : idList('jobIds', 500)(v)))
  jobIds: string[] | null = null;
}

/** A photo computer asking for work: what it can do. */
export class ClaimJobDto {
  @Rule((v) => {
    if (!Array.isArray(v) || v.length > 10 || v.some((x) => typeof x !== 'string' || x.length > 20))
      throw new AppError('features must be a short list.');
    return v;
  })
  features: string[] = [];
}

/** The improved photo's details, as JSON text next to the photo file. */
export class JobResultDto {
  @Rule((value) => {
    if (value && typeof value === 'object') return value; // a rule runs twice: the second time the text is already parsed
    if (typeof value !== 'string' || value.length > 20_000)
      throw new AppError('The details are missing or too long.');
    try {
      return JSON.parse(value);
    } catch {
      throw new AppError('The details are not valid JSON.');
    }
  })
  details: unknown = {};
}

export class JobFailDto {
  @OptionalText(500)
  error: string | null = null;
}
