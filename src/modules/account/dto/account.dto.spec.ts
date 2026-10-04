import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { AddWishlistDto } from './add-wishlist.dto.js';
import { CreateAlertDto } from './create-alert.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

describe('AddWishlistDto', () => {
  it('needs a squareItemId', async () => {
    expect(await body(AddWishlistDto, { squareItemId: ' ITEM1 ' })).toMatchObject({
      squareItemId: 'ITEM1',
    });
    await expect(body(AddWishlistDto, {})).rejects.toMatchObject({
      message: 'squareItemId is required.',
    });
  });
});

describe('CreateAlertDto', () => {
  it('cleans the email and needs a variation', async () => {
    expect(
      await body(CreateAlertDto, { email: ' Fan@Example.com ', variationId: 'V1' }),
    ).toMatchObject({
      email: 'fan@example.com',
      variationId: 'V1',
    });
    await expect(body(CreateAlertDto, { email: 'nope', variationId: 'V1' })).rejects.toMatchObject({
      message: 'Enter a valid email address.',
    });
    await expect(body(CreateAlertDto, { email: 'a@b.co' })).rejects.toMatchObject({
      message: 'variationId is required.',
    });
  });
});
