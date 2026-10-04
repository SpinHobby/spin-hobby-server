import { ValidationPipe, type ArgumentMetadata, type ValidationError } from '@nestjs/common';
import { AppError } from '../errors.js';

/** The first human-readable message in a (possibly nested) validation error tree. */
function firstMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    const own = Object.values(error.constraints ?? {})[0];
    if (own) return own;
    const nested = error.children?.length ? firstMessage(error.children) : '';
    if (nested) return nested;
  }
  return 'Invalid request.';
}

/**
 * Validates request bodies and queries against their DTO class.
 *
 *  - Fields the DTO doesn't declare are dropped, never rejected (the API has always ignored extras).
 *  - The first problem is reported as an AppError (HTTP 400, `{ success: false, error }`), the same
 *    shape every other error in the API uses.
 *  - A body that isn't a JSON object is refused outright.
 */
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new AppError(firstMessage(errors)),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata) {
    const hasDto = metadata.type === 'body' && metadata.metatype && metadata.metatype !== Object;
    if (hasDto && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new AppError('Expected a JSON object.');
    }
    return super.transform(value, metadata);
  }
}
