import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { AddWishlistDto } from './add-wishlist.dto.js';
import { CreateAlertDto } from './create-alert.dto.js';
import { UpdateProfileDto } from './update-profile.dto.js';

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

describe('UpdateProfileDto', () => {
  it('trims names, and blank or missing becomes null', async () => {
    expect(
      await body(UpdateProfileDto, { firstName: ' Aki ', lastName: ' Tanaka ' }),
    ).toMatchObject({ firstName: 'Aki', lastName: 'Tanaka' });
    expect(await body(UpdateProfileDto, { firstName: '' })).toMatchObject({
      firstName: null,
      lastName: null,
    });
    expect(await body(UpdateProfileDto, {})).toMatchObject({ firstName: null, lastName: null });
  });

  it('rejects a name over 80 characters', async () => {
    await expect(body(UpdateProfileDto, { firstName: 'a'.repeat(81) })).rejects.toMatchObject({
      message: 'Invalid text value.',
    });
  });

  it('drops fields it does not declare, such as role', async () => {
    expect(await body(UpdateProfileDto, { firstName: 'Aki', role: 'owner' })).not.toHaveProperty(
      'role',
    );
  });
});
