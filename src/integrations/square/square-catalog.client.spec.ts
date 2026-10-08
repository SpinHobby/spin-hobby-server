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

describe('SquareCatalogClient.setItemHidden', () => {
  const client = new SquareCatalogClient();
  /** An item as Square stores it: several variations, a photo, a tax, and two categories. */
  const stored = (categories: string[]) => ({
    type: 'ITEM',
    id: 'ITEM1',
    version: 12,
    updated_at: '2026-10-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    present_at_all_locations: true,
    item_data: {
      name: 'Rem figure',
      image_ids: ['IMG1'],
      tax_ids: ['TAX1'],
      categories: categories.map((id) => ({ id })),
      variations: [
        { type: 'ITEM_VARIATION', id: 'V1', version: 3, item_variation_data: { name: 'Regular' } },
        { type: 'ITEM_VARIATION', id: 'V2', version: 4, item_variation_data: { name: 'Large' } },
      ],
    },
  });
  const urlOf = (call: number) => fetchMock.mock.calls[call][0] as string;
  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it('adds the hidden marker and changes nothing else about the item', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ objects: [stored(['CAT1'])] }))
      .mockResolvedValueOnce(json({ objects: [stored(['CAT1', CASHIER_CATEGORY_ID])] }));
    const ids = await client.setItemHidden('ITEM1', true);
    expect(ids).toEqual(['CAT1', CASHIER_CATEGORY_ID]);

    expect(urlOf(0)).toContain('/v2/catalog/batch-retrieve');
    expect(bodyOf(0)).toEqual({ object_ids: ['ITEM1'] });
    expect(urlOf(1)).toContain('/v2/catalog/batch-upsert');
    const saved = bodyOf(1).batches[0].objects[0];
    expect(saved.item_data.categories).toEqual([{ id: 'CAT1' }, { id: CASHIER_CATEGORY_ID }]);
    // Everything else is sent back exactly as Square had it, so nothing is reset.
    expect(saved).toMatchObject({ id: 'ITEM1', version: 12, present_at_all_locations: true });
    expect(saved.item_data).toMatchObject({
      name: 'Rem figure',
      image_ids: ['IMG1'],
      tax_ids: ['TAX1'],
    });
    expect(saved.item_data.variations.map((v: { id: string }) => v.id)).toEqual(['V1', 'V2']);
    expect(saved).not.toHaveProperty('updated_at'); // read-only in Square
    expect(saved).not.toHaveProperty('created_at');
  });

  it('removes only the marker when showing an item again', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ objects: [stored(['CAT1', CASHIER_CATEGORY_ID])] }))
      .mockResolvedValueOnce(json({ objects: [stored(['CAT1'])] }));
    expect(await client.setItemHidden('ITEM1', false)).toEqual(['CAT1']);
    expect(bodyOf(1).batches[0].objects[0].item_data.categories).toEqual([{ id: 'CAT1' }]);
  });

  it('makes no write when the item is already in the wanted state', async () => {
    fetchMock.mockResolvedValueOnce(json({ objects: [stored(['CAT1', CASHIER_CATEGORY_ID])] }));
    await client.setItemHidden('ITEM1', true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the read
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json({ objects: [stored(['CAT1'])] }));
    await client.setItemHidden('ITEM1', false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says so when the item is not in Square, and surfaces why Square refused a write', async () => {
    fetchMock.mockResolvedValueOnce(json({ objects: [] }));
    await expect(client.setItemHidden('NOPE', true)).rejects.toMatchObject({
      message: 'This item was not found in Square.',
      status: 404,
    });
    fetchMock.mockResolvedValueOnce(json({ objects: [stored(['CAT1'])] }));
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'Version mismatch.' }] }, 409));
    await expect(client.setItemHidden('ITEM1', true)).rejects.toThrow('Version mismatch.');
  });
});

describe('SquareCatalogClient.deleteItem', () => {
  const client = new SquareCatalogClient();
  const urlOf = (call: number) => fetchMock.mock.calls[call][0] as string;
  const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it('deletes the item together with the photos attached to it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          objects: [{ id: 'ITEM1', type: 'ITEM', item_data: { image_ids: ['IMG1', 'IMG2'] } }],
        }),
      )
      .mockResolvedValueOnce(json({ deleted_object_ids: ['ITEM1', 'V1', 'IMG1', 'IMG2'] }));
    await client.deleteItem('ITEM1');
    expect(urlOf(1)).toContain('/v2/catalog/batch-delete');
    expect(bodyOf(1)).toEqual({ object_ids: ['ITEM1', 'IMG1', 'IMG2'] });
  });

  it('treats an item that is already gone as done, and surfaces why Square refused', async () => {
    fetchMock.mockResolvedValueOnce(json({ objects: [] }));
    await client.deleteItem('GONE');
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing to delete

    fetchMock.mockResolvedValueOnce(json({ objects: [{ id: 'ITEM1', item_data: {} }] }));
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'Item is in use.' }] }, 400));
    await expect(client.deleteItem('ITEM1')).rejects.toThrow('Item is in use.');
  });
});

describe('SquareCatalogClient.attachPhotos', () => {
  it('counts the photos that really arrived, so a caller can tell if any failed', async () => {
    const client = new SquareCatalogClient();
    const attach = vi
      .spyOn(
        client as unknown as { attachPhoto: (...a: unknown[]) => Promise<boolean> },
        'attachPhoto',
      )
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const saved = await client.attachPhotos('ITEM1', 'Rem', [
      Buffer.from('a'),
      Buffer.from('b'),
      Buffer.from('c'),
    ]);
    expect(saved).toBe(2);
    expect(attach.mock.calls.map((c) => c[3])).toEqual([true, false, false]); // only the first is the main picture
  });
});
