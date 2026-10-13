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
