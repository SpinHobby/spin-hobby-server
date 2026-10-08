import { AppError } from '../../../../common/errors.js';
import { Provided, Rule, Text } from '../../../../common/validation/decorators.js';

const aliases = (value: unknown) => {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((a) => typeof a !== 'string' || a.length > 120)
  )
    throw new AppError('Alternate names must be a short list of names.');
  return value.map((a: string) => a.trim()).filter(Boolean);
};

export class CreateSeriesDto {
  @Text('name', 120)
  name!: string;

  /** Other names for it (Japanese title, common spellings). */
  @Rule(aliases)
  aliases: string[] = [];
}

export class UpdateSeriesDto {
  @Provided()
  @Rule((v) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 120)
      throw new AppError('Enter a series name (120 characters at most).');
    return v.trim();
  })
  name?: string;

  @Provided()
  @Rule(aliases)
  aliases?: string[];
}
