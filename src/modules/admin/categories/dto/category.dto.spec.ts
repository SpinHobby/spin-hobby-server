import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { sentFields } from '../../dto/defined-fields.js';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './category.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });
const ID = '0b9c3f2e-4d5a-4e0b-9f6a-2d1c8e7b5a43';

describe('CreateCategoryDto', () => {
  it('squeezes spaces, defaults to a visible top-level category', async () => {
    expect(await body(CreateCategoryDto, { name: '  Scale    Figures ' })).toMatchObject({
      name: 'Scale Figures',
      parentId: null,
      isVisible: true,
    });
  });

  it('takes a parent id and a hidden flag', async () => {
    expect(
      await body(CreateCategoryDto, { name: 'x', parentId: ID, isVisible: false }),
    ).toMatchObject({ parentId: ID, isVisible: false });
  });

  it('checks the parent id before the name', async () => {
    await expect(body(CreateCategoryDto, { name: 'x', parentId: 'nope' })).rejects.toMatchObject({
      message: 'Invalid category.',
    });
    await expect(body(CreateCategoryDto, {})).rejects.toMatchObject({
      message: 'name is required.',
    });
    await expect(body(CreateCategoryDto, { name: 'x'.repeat(81) })).rejects.toMatchObject({
      message: 'name is required.',
    });
  });
});

describe('UpdateCategoryDto', () => {
  it('only carries what was sent', async () => {
    expect(
      sentFields(await body(UpdateCategoryDto, { name: ' New  name ', isVisible: true, junk: 1 })),
    ).toEqual({ name: 'New name', isVisible: true });
  });

  it('moves to the top level with null, which is different from not sending a parent', async () => {
    expect(sentFields(await body(UpdateCategoryDto, { parentId: null }))).toEqual({
      parentId: null,
    });
    expect(sentFields(await body(UpdateCategoryDto, { parentId: '' }))).toEqual({ parentId: null });
    expect(sentFields(await body(UpdateCategoryDto, {}))).toEqual({});
  });
});

describe('ReorderCategoriesDto', () => {
  it('takes up to 500 category ids', async () => {
    expect(await body(ReorderCategoriesDto, { ids: [ID] })).toMatchObject({ ids: [ID] });
  });

  it.each([undefined, 'x', ['not-a-uuid'], [1], Array.from({ length: 501 }, () => ID)])(
    'rejects %j',
    async (ids) => {
      await expect(body(ReorderCategoriesDto, { ids })).rejects.toMatchObject({
        message: 'ids is required.',
      });
    },
  );
});
