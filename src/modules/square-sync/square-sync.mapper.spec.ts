import { describe, expect, it } from 'vitest';
import { CASHIER_CATEGORY_ID } from '../../config/square.config.js';
import { mapCatalogPage } from './square-sync.mapper.js';

const CATEGORIES = new Map([['CAT1', 'Plushies']]);
const item = (overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  id: 'ITEM1',
  type: 'ITEM',
  updated_at: '2026-09-01T00:00:00Z',
  item_data: {
    name: 'Rem plush',
    description: 'Soft',
    categories: [{ id: 'CAT1' }],
    variations: [
      {
        id: 'VAR1',
        type: 'ITEM_VARIATION',
        item_variation_data: { name: 'Regular', sku: 'REM-1', price_money: { amount: 2500 } },
      },
    ],
    ...data,
  },
  ...overrides,
});
const map = (items: unknown[], related: unknown[] = []) =>
  mapCatalogPage(items as never, related as never, CATEGORIES);

describe('mapCatalogPage', () => {
  it('maps an item, its variation and its category name', () => {
    const { productRows, variationRows } = map([item()]);
    expect(productRows).toEqual([
      {
        id: 'ITEM1',
        name: 'Rem plush',
        description: 'Soft',
        category: 'Plushies',
        category_ids: ['CAT1'],
        default_variation_id: 'VAR1',
        active: true,
        visible: true,
        updated_at: '2026-09-01T00:00:00Z',
      },
    ]);
    expect(variationRows).toEqual([
      {
        id: 'VAR1',
        item_id: 'ITEM1',
        name: 'Regular',
        sku: 'REM-1',
        price: 2500,
        sellable: true,
        updated_at: '2026-09-01T00:00:00Z',
      },
    ]);
  });

  it('skips anything that is not an item with item data', () => {
    const { catalogItems } = map([
      item(),
      { id: 'CAT9', type: 'CATEGORY' },
      { id: 'ITEM2', type: 'ITEM' },
    ]);
    expect(catalogItems.map((i) => i.id)).toEqual(['ITEM1']);
  });

  it('prefers the reporting category, falls back to the id when the name is unknown, and to the older category_id', () => {
    expect(map([item({}, { reporting_category: { id: 'CAT1' } })]).productRows[0].category).toBe(
      'Plushies',
    );
    expect(map([item({}, { categories: [{ id: 'UNKNOWN' }] })]).productRows[0].category).toBe(
      'UNKNOWN',
    );
    const old = map([item({}, { categories: undefined, category_id: 'CAT1' })]).productRows[0];
    expect(old).toMatchObject({ category: 'Plushies', category_ids: ['CAT1'] });
    const none = map([item({}, { categories: undefined })]).productRows[0];
    expect(none).toMatchObject({ category: null, category_ids: [] });
  });

  it('hides items the cashier keeps off the website, but keeps them active', () => {
    const { productRows } = map([
      item({}, { categories: [{ id: 'CAT1' }, { id: CASHIER_CATEGORY_ID }] }),
    ]);
    expect(productRows[0]).toMatchObject({ active: true, visible: false });
  });

  it('keeps an item off the website when Square itself hides it', () => {
    expect(map([item({}, { ecom_visibility: 'HIDDEN' })]).productRows[0]).toMatchObject({
      active: true,
      visible: false,
    });
    const saved = process.env.SQUARE_LOCATION_ID;
    process.env.SQUARE_LOCATION_ID = 'LOC1';
    try {
      expect(map([item({ absent_at_location_ids: ['LOC1'] })]).productRows[0].visible).toBe(false);
      expect(map([item({ absent_at_location_ids: ['OTHER'] })]).productRows[0].visible).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.SQUARE_LOCATION_ID;
      else process.env.SQUARE_LOCATION_ID = saved;
    }
  });

  it('marks a deleted item neither active nor visible', () => {
    expect(map([item({ is_deleted: true })]).productRows[0]).toMatchObject({
      active: false,
      visible: false,
    });
  });

  it('chooses the first variation that is not deleted as the default, and keeps deleted ones as unsellable', () => {
    const { productRows, variationRows } = map([
      item(
        {},
        {
          variations: [
            { id: 'V1', is_deleted: true, item_variation_data: {} },
            { id: 'V2', item_variation_data: { price_money: { amount: 900 } } },
          ],
        },
      ),
    ]);
    expect(productRows[0].default_variation_id).toBe('V2');
    expect(variationRows.map((v) => [v.id, v.sellable, v.price])).toEqual([
      ['V1', false, 0],
      ['V2', true, 900],
    ]);
  });

  it('has no default variation when every variation is deleted', () => {
    const { productRows } = map([item({}, { variations: [{ id: 'V1', is_deleted: true }] })]);
    expect(productRows[0].default_variation_id).toBeNull();
  });

  it('attaches image URLs in order, and ignores image ids Square did not send', () => {
    const { imageRows } = map(
      [item({}, { image_ids: ['IMG1', 'IMG2', 'MISSING'] })],
      [
        { id: 'IMG1', type: 'IMAGE', image_data: { url: 'https://sq/1.jpg' } },
        { id: 'IMG2', type: 'IMAGE', image_data: { url: 'https://sq/2.jpg' } },
        { id: 'OTHER', type: 'CATEGORY' },
      ],
    );
    expect([...imageRows.values()]).toEqual([
      { item_id: 'ITEM1', image_id: 'IMG1', url: 'https://sq/1.jpg', sort: 0 },
      { item_id: 'ITEM1', image_id: 'IMG2', url: 'https://sq/2.jpg', sort: 1 },
    ]);
  });

  it('gives a shared image to the last item that uses it', () => {
    const { imageRows } = map(
      [item({}, { image_ids: ['IMG1'] }), item({ id: 'ITEM2' }, { image_ids: ['IMG1'] })],
      [{ id: 'IMG1', type: 'IMAGE', image_data: { url: 'https://sq/1.jpg' } }],
    );
    expect(imageRows.get('IMG1')?.item_id).toBe('ITEM2');
  });
});
