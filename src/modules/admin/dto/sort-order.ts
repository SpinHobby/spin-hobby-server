import { Rule } from '../../../common/validation/decorators.js';

/** Display position: any whole number; anything else (missing, text) counts as 0. */
export const SortOrder = () => Rule((v) => (Number.isInteger(Number(v)) ? Number(v) : 0));

/** For partial updates: a whole number, or undefined (ignored) when it isn't one. */
export const OptionalSortOrder = () =>
  Rule((v) => (Number.isInteger(Number(v)) ? Number(v) : undefined));
