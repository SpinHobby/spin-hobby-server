import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';

const between = (field: string, min: number, max: number) =>
  Rule((value) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new AppError(`"${field}" must be a number from ${min} to ${max}.`);
    return Math.round(n * 100) / 100;
  });

/** Where one product photo sits in its square: the point kept in view (x, y in %) and the zoom (1 = none). */
export class PhotoFrameDto {
  @Rule((value) => {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value) || value.length > 1000)
      throw new AppError("Send the photo's address.");
    return value;
  })
  url!: string;

  @between('x', 0, 100)
  x!: number;

  @between('y', 0, 100)
  y!: number;

  @between('zoom', 1, 4)
  zoom!: number;
}
