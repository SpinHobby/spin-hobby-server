import { afterEach, describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { sentFields } from '../../dto/defined-fields.js';
import { CreateManualProductDto } from './create-manual-product.dto.js';
import { UpdateManualProductDto } from './update-manual-product.dto.js';
import { UploadImageDto } from './upload-image.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });
const CATEGORY = '0b9c3f2e-4d5a-4e0b-9f6a-2d1c8e7b5a43';

afterEach(() => {
  process.env.NODE_ENV = 'test';
});

describe('CreateManualProductDto', () => {
  const ok = { name: ' Con Exclusive ', priceCents: 2500 };

  it('fills in the defaults for a name and price', async () => {
    expect(await body(CreateManualProductDto, ok)).toMatchObject({
      name: 'Con Exclusive',
      priceCents: 2500,
      stockCount: null,
      imageUrls: [],
      availability: 'auto',
      orderByDate: null,
      releaseMonth: null,
      categoryId: null,
      description: null,
      janCode: null,
      compareAtCents: null,
      maxPerCustomer: null,
      isFeatured: false,
    });
  });

  it('cleans every optional field', async () => {
    expect(
      await body(CreateManualProductDto, {
        ...ok,
        stockCount: '4',
        imageUrls: ['https://img/a.jpg'],
        availability: 'preorder',
        orderByDate: '2027-01-31',
        releaseMonth: '2027-03',
        categoryId: CATEGORY,
        compareAtCents: '3000',
        maxPerCustomer: '2',
        isFeatured: true,
        janCode: ' 4580 ',
      }),
    ).toMatchObject({
      stockCount: 4,
      availability: 'preorder',
      releaseMonth: '2027-03',
      compareAtCents: 3000,
      maxPerCustomer: 2,
      isFeatured: true,
      janCode: '4580',
    });
  });

  it('treats anything but "preorder" as normal availability', async () => {
    expect(await body(CreateManualProductDto, { ...ok, availability: 'hidden' })).toMatchObject({
      availability: 'auto',
    });
  });

  it.each([
    [{ name: '', priceCents: 100 }, 'name is required.'],
    [{ name: 'x', priceCents: 0 }, 'Enter a price above $0.'],
    [{ name: 'x', priceCents: 10_000_001 }, 'Enter a price above $0.'],
    [{ name: 'x', priceCents: 1.5 }, 'Enter a price above $0.'],
    [{ ...ok, stockCount: -1 }, 'Stock must be a whole number of 0 or more.'],
    [{ ...ok, stockCount: 100_001 }, 'Stock must be a whole number of 0 or more.'],
    [
      { ...ok, imageUrls: Array.from({ length: 9 }, () => 'https://x/y.jpg') },
      'Add up to 8 photos.',
    ],
    [{ ...ok, imageUrls: 'https://x/y.jpg' }, 'Add up to 8 photos.'],
    [
      { ...ok, imageUrls: ['http://insecure.example/y.jpg'] },
      'Photo URLs must start with https://',
    ],
    [{ ...ok, orderByDate: 'soon' }, 'Invalid order-by date.'],
    [{ ...ok, releaseMonth: 'spring' }, 'Invalid release month.'],
    [{ ...ok, categoryId: 'nope' }, 'Invalid category.'],
    [{ ...ok, compareAtCents: -5 }, 'Enter a price above $0.'],
    [{ ...ok, maxPerCustomer: 5000 }, 'maxPerCustomer must be between 1 and 1000.'],
  ])('rejects %j', async (input, message) => {
    await expect(body(CreateManualProductDto, input)).rejects.toMatchObject({
      message,
      status: 400,
    });
  });

  it('allows plain-http photo URLs on localhost outside production only', async () => {
    const local = { ...ok, imageUrls: ['http://localhost:8080/uploads/a.jpg'] };
    process.env.NODE_ENV = 'development';
    expect(await body(CreateManualProductDto, local)).toMatchObject({
      imageUrls: ['http://localhost:8080/uploads/a.jpg'],
    });
    process.env.NODE_ENV = 'production';
    await expect(body(CreateManualProductDto, local)).rejects.toMatchObject({
      message: 'Photo URLs must start with https://',
    });
  });
});

describe('UpdateManualProductDto', () => {
  it('only carries what was sent', async () => {
    const dto = await body(UpdateManualProductDto, { name: ' New ', priceCents: '1999', other: 1 });
    expect(sentFields(dto)).toEqual({ name: 'New', priceCents: 1999 });
  });

  it('can set stock to untracked (null) or clear text, which is different from not sending it', async () => {
    expect(
      sentFields(await body(UpdateManualProductDto, { stockCount: null, description: '' })),
    ).toEqual({ stockCount: null, description: null });
    expect(sentFields(await body(UpdateManualProductDto, {}))).toEqual({});
  });

  it('replaces the photos with a validated list', async () => {
    expect(sentFields(await body(UpdateManualProductDto, { imageUrls: [] }))).toEqual({
      imageUrls: [],
    });
    await expect(body(UpdateManualProductDto, { imageUrls: null })).rejects.toMatchObject({
      message: 'Add up to 8 photos.',
    });
    await expect(body(UpdateManualProductDto, { priceCents: 0 })).rejects.toMatchObject({
      message: 'Enter a price above $0.',
    });
  });
});

describe('UploadImageDto', () => {
  const png = Buffer.from('hello').toString('base64');

  it('accepts base64 with or without a data: prefix, and defaults the folder to products', async () => {
    expect(await body(UploadImageDto, { contentType: 'image/png', data: png })).toMatchObject({
      data: png,
      folder: 'products',
    });
    expect(
      await body(UploadImageDto, {
        contentType: 'image/png',
        data: `data:image/png;base64,${png}`,
        folder: 'slides',
      }),
    ).toMatchObject({
      data: png,
      folder: 'slides',
    });
  });

  it('rejects data that is not base64, and a missing content type', async () => {
    await expect(
      body(UploadImageDto, { contentType: 'image/png', data: 'not base64!!' }),
    ).rejects.toMatchObject({ message: 'The image data is invalid.' });
    await expect(body(UploadImageDto, { data: png })).rejects.toMatchObject({
      message: 'contentType is required.',
    });
  });
});
