import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASHIER_CATEGORY_ID, SQUARE_CATALOG_API_VERSION } from '../../config/square.config.js';
import { SquareCatalogClient } from './square-catalog.client.js';

const SAVED = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.SQUARE_ACCESS_TOKEN = 'sq-token';
  process.env.SQUARE_LOCATION_ID = 'LOC1';
  delete process.env.SQUARE_ENVIRONMENT;
  delete process.env.SQUARE_ENV;
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the last batch-upsert call sent, parsed. */
const sentObject = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body).batches[0].objects[0];

describe('SquareCatalogClient.createLocationItem', () => {
  const client = new SquareCatalogClient();
  const item = { name: 'Rem figure', description: 'Mint', price: 3900, hidden: false };

  it('creates a location-scoped item with one "Regular" variation at the given price', async () => {
    fetchMock.mockResolvedValue(json({ objects: [{ id: 'ITEM1' }] }));
    const created = await client.createLocationItem(item);
    expect(created).toEqual({ id: 'ITEM1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://connect.squareupsandbox.com/v2/catalog/batch-upsert');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sq-token',
      'Square-Version': SQUARE_CATALOG_API_VERSION,
    });
    const body = JSON.parse(init.body);
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(sentObject()).toMatchObject({
      type: 'ITEM',
      id: '#item',
      present_at_all_locations: false,
      present_at_location_ids: ['LOC1'],
      item_data: {
        name: 'Rem figure',
        description: 'Mint',
        ecom_visibility: 'VISIBLE',
        variations: [
          {
            id: '#item-variation',
            item_variation_data: {
              name: 'Regular',
              pricing_type: 'FIXED_PRICING',
              price_money: { amount: 3900, currency: 'CAD' },
            },
          },
        ],
      },
    });
    expect(sentObject().item_data.categories).toBeUndefined();
  });

  it('marks hidden items with the "not for the website" category next to the shop category', async () => {
    fetchMock.mockResolvedValue(json({ objects: [{ id: 'ITEM1' }] }));
    await client.createLocationItem({ ...item, hidden: true, categoryId: 'CAT1' });
    const data = sentObject().item_data;
    expect(data.ecom_visibility).toBe('HIDDEN');
    expect(data.categories).toEqual([{ id: 'CAT1' }, { id: CASHIER_CATEGORY_ID }]);
    expect(data.reporting_category).toEqual({ id: 'CAT1' });
  });

  it("surfaces Square's reason, or a clear default, when the write fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'Bad price.' }] }, 400));
    await expect(client.createLocationItem(item)).rejects.toThrow('Bad price.');
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(client.createLocationItem(item)).rejects.toThrow(
      'Failed to create Square catalog item',
    );
  });
});

describe('SquareCatalogClient.updateLocationItem', () => {
  const client = new SquareCatalogClient();
  const existing = {
    type: 'ITEM',
    id: 'ITEM1',
    version: 7n,
    itemData: {
      imageIds: ['IMG1'],
      variations: [{ type: 'ITEM_VARIATION', id: 'VAR1', version: 9n }],
    },
  };
  const update = { itemId: 'ITEM1', name: 'Rem figure', price: 4200, hidden: false };

  beforeEach(() => {
    // The live item is fetched with the SDK first (for Square's version check); stub that call.
    vi.spyOn(client, 'getItem').mockResolvedValue({
      item: existing as never,
      relatedObjects: [],
    });
    fetchMock.mockResolvedValue(json({ objects: [{ id: 'ITEM1' }] }));
  });

  it('re-sends the live versions and keeps the existing photos when the photo is untouched', async () => {
    await client.updateLocationItem(update);
    const object = sentObject();
    expect(object).toMatchObject({ type: 'ITEM', id: 'ITEM1', version: 7 });
    expect(object.item_data.image_ids).toEqual(['IMG1']);
    expect(object.item_data.variations[0]).toMatchObject({
      id: 'VAR1',
      version: 9,
      item_variation_data: { item_id: 'ITEM1', price_money: { amount: 4200, currency: 'CAD' } },
    });
  });

  it('clears the photos when asked to remove them', async () => {
    await client.updateLocationItem({ ...update, removePhoto: true });
    expect(sentObject().item_data.image_ids).toEqual([]);
  });

  it('refuses an item that is not in Square, or has no variation', async () => {
    vi.spyOn(client, 'getItem').mockResolvedValueOnce({ item: null, relatedObjects: [] });
    await expect(client.updateLocationItem(update)).rejects.toThrow('Item ITEM1 not found');
    vi.spyOn(client, 'getItem').mockResolvedValueOnce({
      item: { type: 'ITEM', id: 'ITEM1', itemData: { variations: [] } } as never,
      relatedObjects: [],
    });
    await expect(client.updateLocationItem(update)).rejects.toThrow(
      'Item ITEM1 has no variation to update',
    );
  });

  it("surfaces Square's reason, or a clear default, when the write fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'Version mismatch.' }] }, 409));
    await expect(client.updateLocationItem(update)).rejects.toThrow('Version mismatch.');
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(client.updateLocationItem(update)).rejects.toThrow(
      'Failed to update Square catalog item',
    );
  });
});
