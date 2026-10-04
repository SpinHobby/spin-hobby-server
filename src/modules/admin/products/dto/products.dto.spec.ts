import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { ProductQuery } from '../../../catalog/dto/product-query.dto.js';
import { sentFields } from '../../dto/defined-fields.js';
import { AdminProductsQuery } from './admin-products.query.dto.js';
import { BulkCategoryDto } from './bulk-category.dto.js';
import { CatalogSearchQuery } from './catalog-search.query.dto.js';
import { UpdateProductDto } from './update-product.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });
const query = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'query', metatype });
const CATEGORY = '0b9c3f2e-4d5a-4e0b-9f6a-2d1c8e7b5a43';

describe('UpdateProductDto', () => {
  it('only carries what was sent, and a blank string clears a field', async () => {
    const dto = await body(UpdateProductDto, { series: '', jan_code: '4580', extra: 1 });
    expect(sentFields(dto)).toEqual({ series: null, jan_code: '4580' });
  });

  it('features only on a real true', async () => {
    expect(sentFields(await body(UpdateProductDto, { is_featured: 'true' }))).toEqual({
      is_featured: false,
    });
    expect(sentFields(await body(UpdateProductDto, { is_featured: true }))).toEqual({
      is_featured: true,
    });
  });

  it('checks availability, but lets a blank through (it clears the field)', async () => {
    await expect(body(UpdateProductDto, { availability: 'maybe' })).rejects.toMatchObject({
      message: 'Invalid availability.',
    });
    expect(sentFields(await body(UpdateProductDto, { availability: 'preorder' }))).toEqual({
      availability: 'preorder',
    });
    expect(sentFields(await body(UpdateProductDto, { availability: '' }))).toEqual({
      availability: null,
    });
  });

  it.each([
    [{ compare_at_cents: -5 }, 'Invalid compare_at_cents.'],
    [{ max_per_customer: 1.5 }, 'Invalid max_per_customer.'],
    [{ deposit_cents: 'lots' }, 'Invalid deposit_cents.'],
    [{ sort_order: -1 }, 'Invalid sort_order.'],
    [{ category_id: 'not-a-uuid' }, 'Invalid category.'],
  ])('rejects %j', async (input, message) => {
    await expect(body(UpdateProductDto, input)).rejects.toMatchObject({ message });
  });

  it('accepts whole numbers, zero, null and blank for the numeric fields', async () => {
    expect(
      sentFields(
        await body(UpdateProductDto, {
          compare_at_cents: 0,
          max_per_customer: null,
          sort_order: '3',
          deposit_cents: '',
        }),
      ),
    ).toEqual({
      compare_at_cents: 0,
      max_per_customer: null,
      sort_order: '3',
      deposit_cents: null,
    });
  });

  it('takes a category id or clears it', async () => {
    expect(sentFields(await body(UpdateProductDto, { category_id: CATEGORY }))).toEqual({
      category_id: CATEGORY,
    });
    expect(sentFields(await body(UpdateProductDto, { category_id: null }))).toEqual({
      category_id: null,
    });
    expect(sentFields(await body(UpdateProductDto, { category_id: '' }))).toEqual({
      category_id: null,
    });
  });
});

describe('BulkCategoryDto', () => {
  it('takes ids and an optional category', async () => {
    expect(await body(BulkCategoryDto, { ids: ['a', 'b'], categoryId: CATEGORY })).toMatchObject({
      ids: ['a', 'b'],
      categoryId: CATEGORY,
    });
    expect(await body(BulkCategoryDto, { ids: ['a'] })).toMatchObject({ categoryId: null });
  });

  it.each([undefined, [], 'a', [1], Array.from({ length: 501 }, () => 'x')])(
    'needs 1 to 500 string ids (got %j)',
    async (ids) => {
      await expect(body(BulkCategoryDto, { ids })).rejects.toMatchObject({
        message: 'Select at least one product.',
      });
    },
  );

  it('rejects a malformed category id', async () => {
    await expect(body(BulkCategoryDto, { ids: ['a'], categoryId: 'nope' })).rejects.toMatchObject({
      message: 'Invalid category.',
    });
  });
});

/** Whitelisting drops any field a query class doesn't declare, so a typo or a new filter added without a decorator would silently vanish. */
describe('query classes keep every filter they document', () => {
  const productFilters = {
    limit: '5',
    cursor: '10',
    category: 'Plush',
    status: 'in',
    sort: 'new',
    min: '1',
    max: '9',
    q: 'rem',
    categoryId: CATEGORY,
    group: 'sale',
    ids: 'a,b',
  };

  it('ProductQuery', async () => {
    expect({ ...((await query(ProductQuery, { ...productFilters, junk: 1 })) as object) }).toEqual(
      productFilters,
    );
  });

  it('AdminProductsQuery', async () => {
    expect({
      ...((await query(AdminProductsQuery, { ...productFilters, filter: 'low' })) as object),
    }).toEqual({ ...productFilters, filter: 'low' });
  });

  it('CatalogSearchQuery', async () => {
    const all = {
      q: 'x',
      status: 'in',
      source: 'square',
      categoryId: 'none',
      featured: '1',
      alerts: '1',
      noPhoto: '1',
      min: '1',
      max: '2',
      sort: 'name',
      dir: 'asc',
      limit: '5',
      cursor: '5',
    };
    expect({ ...((await query(CatalogSearchQuery, { ...all, junk: 1 })) as object) }).toEqual(all);
  });
});
