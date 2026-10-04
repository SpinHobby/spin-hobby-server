import { describe, expect, it } from 'vitest';
import { CASHIER_CATEGORY_ID } from '../../config/square.config.js';
import { toDetail, toSearchResult, type SquareItem } from './cashier-items.mapper.js';

const item: SquareItem = {
  id: 'ITEM1',
  type: 'ITEM',
  itemData: {
    name: 'Pikachu',
    description: 'Holo',
    categories: [{ id: CASHIER_CATEGORY_ID }, { id: 'CAT1' }],
    imageIds: ['IMG1'],
    variations: [
      { id: 'VAR1', type: 'ITEM_VARIATION', itemVariationData: { priceMoney: { amount: 1250n } } },
    ],
  },
};
const images = new Map([['IMG1', 'https://img/1.jpg']]);

describe('cashier item mapping', () => {
  it('maps a search row, treating the marker category as "hidden" rather than a shop category', () => {
    expect(toSearchResult(item, images, new Map([['CAT1', 'Cards']]), { VAR1: 4 })).toEqual({
      id: 'ITEM1',
      name: 'Pikachu',
      priceCents: 1250,
      hidden: true,
      imageUrl: 'https://img/1.jpg',
      categoryId: 'CAT1',
      categoryName: 'Cards',
      stockCount: 4,
    });
  });

  it('reports no stock count when Square has none, and a visible item when there is no marker', () => {
    const plain: SquareItem = { ...item, itemData: { ...item.itemData, categories: [] } };
    expect(toSearchResult(plain, images, new Map(), {})).toMatchObject({
      hidden: false,
      stockCount: null,
      categoryId: undefined,
    });
  });

  it('maps the detail view with the description and variation id', () => {
    const detail = toDetail(
      item,
      [{ id: 'IMG1', type: 'IMAGE', imageData: { url: 'u' } }],
      [{ id: 'CAT1', categoryData: { name: 'Cards' } }],
      { VAR1: 0 },
    );
    expect(detail).toMatchObject({
      description: 'Holo',
      variationId: 'VAR1',
      categoryName: 'Cards',
      stockCount: 0,
      imageUrl: 'u',
      priceCents: 1250,
    });
  });
});
