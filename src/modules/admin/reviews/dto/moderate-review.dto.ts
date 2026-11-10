import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule } from '../../../../common/validation/decorators.js';

/** Staff's decision on a review: show it on the shop or not, with an optional public reply. */
export class ModerateReviewDto {
  @Rule((v) => {
    if (v !== 'approved' && v !== 'rejected' && v !== 'pending')
      throw new AppError('Status must be approved, rejected or pending.');
    return v;
  })
  status!: 'approved' | 'rejected' | 'pending';

  /** The shop's answer under the review; blank removes it. */
  @OptionalText(1000)
  reply: string | null = null;
}
