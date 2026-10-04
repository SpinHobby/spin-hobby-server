import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { sentFields } from '../../dto/defined-fields.js';
import { CreateSlideDto, ReorderSlidesDto, UpdateSlideDto } from './slide.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

describe('CreateSlideDto', () => {
  it('fills in the defaults for a bare headline', async () => {
    expect(await body(CreateSlideDto, { headline: ' Sale ' })).toMatchObject({
      headline: 'Sale',
      subheading: null,
      imageUrl: null,
      linkUrl: null,
      isVisible: false,
      sortOrder: 0,
    });
  });

  it('shows the slide only for a real true, and tolerates a junk sort order', async () => {
    expect(
      await body(CreateSlideDto, { headline: 'x', isVisible: 'true', sortOrder: 'soon' }),
    ).toMatchObject({ isVisible: false, sortOrder: 0 });
    expect(
      await body(CreateSlideDto, { headline: 'x', isVisible: true, sortOrder: '3' }),
    ).toMatchObject({ isVisible: true, sortOrder: 3 });
  });

  it('needs a headline of at most 160 characters', async () => {
    await expect(body(CreateSlideDto, {})).rejects.toMatchObject({
      message: 'headline is required.',
    });
    await expect(body(CreateSlideDto, { headline: 'x'.repeat(161) })).rejects.toMatchObject({
      message: 'headline is required.',
    });
  });
});

describe('UpdateSlideDto', () => {
  it('only carries what was sent, mapping text and flags', async () => {
    const dto = await body(UpdateSlideDto, {
      isVisible: true,
      linkUrl: ' https://x.co ',
      sortOrder: 'nope',
      other: 1,
    });
    expect(sentFields(dto)).toEqual({ isVisible: true, linkUrl: 'https://x.co' });
  });

  it('allows clearing optional text, but not the headline', async () => {
    expect(sentFields(await body(UpdateSlideDto, { subheading: '' }))).toEqual({
      subheading: null,
    });
    await expect(body(UpdateSlideDto, { headline: '  ' })).rejects.toMatchObject({
      message: 'headline is required.',
    });
  });
});

describe('ReorderSlidesDto', () => {
  it('takes a list of ids', async () => {
    expect(await body(ReorderSlidesDto, { ids: ['a', 'b'] })).toMatchObject({ ids: ['a', 'b'] });
  });

  it.each([undefined, 'a', [1], Array.from({ length: 101 }, () => 'x')])(
    'rejects %j',
    async (ids) => {
      await expect(body(ReorderSlidesDto, { ids })).rejects.toMatchObject({
        message: 'ids is required.',
      });
    },
  );
});
