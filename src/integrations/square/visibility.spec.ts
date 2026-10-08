import { describe, expect, it } from 'vitest';
import { CASHIER_CATEGORY_ID } from '../../config/square.config.js';
import { isHiddenFromWebsite, isHiddenInSquareItself, isMarkedHidden } from './visibility.js';

const item = (extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  type: 'ITEM',
  id: 'ITEM1',
  present_at_all_locations: true,
  item_data: { name: 'Rem figure', ...data },
  ...extra,
});

describe('what Square says is hidden from the website', () => {
  it('shows an ordinary item, and one with no visibility data at all', () => {
    expect(isHiddenFromWebsite(item(), 'LOC1')).toBe(false);
    expect(isHiddenFromWebsite(item({}, { ecom_visibility: 'VISIBLE' }), 'LOC1')).toBe(false);
    expect(isHiddenFromWebsite(item({}, { ecom_visibility: 'UNINDEXED' }), 'LOC1')).toBe(false);
  });

  it('hides an item carrying our "not for the website" category, new or old style', () => {
    expect(
      isMarkedHidden(item({}, { categories: [{ id: 'A' }, { id: CASHIER_CATEGORY_ID }] })),
    ).toBe(true);
    expect(isMarkedHidden(item({}, { category_id: CASHIER_CATEGORY_ID }))).toBe(true);
    expect(isMarkedHidden(item({}, { categories: [{ id: 'A' }] }))).toBe(false);
  });

  it("hides an item Square's own online visibility marks as Hidden", () => {
    expect(isHiddenInSquareItself(item({}, { ecom_visibility: 'HIDDEN' }), 'LOC1')).toBe(true);
  });

  it('hides an item that is not sold at our location, and only when Square says so explicitly', () => {
    expect(isHiddenInSquareItself(item({ absent_at_location_ids: ['LOC1'] }), 'LOC1')).toBe(true);
    expect(isHiddenInSquareItself(item({ absent_at_location_ids: ['OTHER'] }), 'LOC1')).toBe(false);
    const someLocations = { present_at_all_locations: false, present_at_location_ids: ['OTHER'] };
    expect(isHiddenInSquareItself(item(someLocations), 'LOC1')).toBe(true);
    expect(
      isHiddenInSquareItself(item({ ...someLocations, present_at_location_ids: ['LOC1'] }), 'LOC1'),
    ).toBe(false);
    // Not enough information, or no location configured: never hide.
    expect(isHiddenInSquareItself(item({ present_at_all_locations: false }), 'LOC1')).toBe(false);
    expect(isHiddenInSquareItself(item({ absent_at_location_ids: ['LOC1'] }), undefined)).toBe(
      false,
    );
  });
});
