import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { RecordItemDto, UpdateItemDto } from './cashier.dto.js';

const pipe = new AppValidationPipe();
const parse = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

describe.each([
  ['RecordItemDto', RecordItemDto],
  ['UpdateItemDto', UpdateItemDto],
])('%s', (_name, dto) => {
  it('hides the item unless the form says hidden=false', async () => {
    expect(await parse(dto, { title: 'Pikachu', price: '5' })).toMatchObject({ hidden: true });
    expect(await parse(dto, { title: 'Pikachu', price: '5', hidden: 'true' })).toMatchObject({
      hidden: true,
    });
    expect(await parse(dto, { title: 'Pikachu', price: '5', hidden: 'false' })).toMatchObject({
      hidden: false,
    });
  });

  it.each([
    [{ price: '5' }, 'title and price are required'],
    [{ title: '', price: '5' }, 'title and price are required'],
    [{ title: 'x' }, 'price must be a positive number'],
    [{ title: 'x', price: '' }, 'price must be a positive number'],
    [{ title: 'x', price: '0' }, 'price must be a positive number'],
    [{ title: 'x', price: '-3' }, 'price must be a positive number'],
    [{ title: 'x', price: 'free' }, 'price must be a positive number'],
  ])('rejects %j', async (input, message) => {
    await expect(parse(dto, input)).rejects.toMatchObject({ message, status: 400 });
  });

  it('keeps the other fields as sent', async () => {
    expect(
      await parse(dto, { title: 'x', price: '1.5', description: 'Mint', quantity: '3' }),
    ).toMatchObject({ title: 'x', price: '1.5', description: 'Mint', quantity: '3' });
  });
});

describe('empty multipart posts', () => {
  it('reach the field checks instead of failing as a bad body', async () => {
    await expect(parse(RecordItemDto, undefined)).rejects.toMatchObject({
      message: 'title and price are required',
    });
  });
});
