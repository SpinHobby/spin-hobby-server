import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ACCOUNTS,
  clearSampleAccounts,
  sampleAccountEmail,
  seedSampleAccounts,
} from '../../src/modules/sample/accounts.js';
import { sampleImageFor } from '../../src/modules/sample/images.js';
import { SAMPLE_GLOSSARY } from '../../src/modules/sample/catalog.js';
import {
  frameSamplePortraits,
  seedSample,
  tidySamplePictures,
} from '../../src/modules/sample/seed.js';
import { createDatabase } from '../support/harness.js';

describe('sample shop', () => {
  it('records when its paid orders were paid, as a real payment does', async () => {
    const { pglite } = await createDatabase();
    await seedSample(pglite, 'http://localhost:8080');
    const { rows } = await pglite.query<{ status: string; paid: boolean }>(
      'select status, paid_at is not null as paid from public.orders',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const o of rows) expect(o.paid).toBe(!['pending', 'cancelled'].includes(o.status));
    await pglite.close();
  });

  it('adds extra editions when asked (dev:local), each with its own id, JAN and an existing picture', async () => {
    const { pglite } = await createDatabase();
    const seeded = await seedSample(pglite, 'http://localhost:8080', { more: 520 });
    expect(seeded.products).toBeGreaterThan(600);
    const { rows } = await pglite.query<{
      n: number;
      jans: number;
      hidden: number;
      sold_out: number;
    }>(
      `select count(*)::int as n, count(distinct m.jan_code)::int as jans,
              count(*) filter (where m.availability = 'hidden')::int as hidden,
              count(*) filter (where i.quantity = 0)::int as sold_out
         from public.catalog_products p
         join public.product_metadata m using (square_item_id)
         join public.catalog_variations v on v.square_item_id = p.square_item_id
         left join public.inventory_snapshots i using (square_variation_id)`,
    );
    expect(rows[0].n).toBe(seeded.products);
    expect(rows[0].jans).toBe(seeded.products);
    expect(rows[0].hidden).toBeGreaterThan(0);
    expect(rows[0].sold_out).toBeGreaterThan(0);
    const drawn = await pglite.query<{ image_url: string }>(
      "select image_url from public.product_images where image_url like '%.svg' limit 1",
    );
    expect(sampleImageFor(drawn.rows[0].image_url.split('/').pop()!)).toContain('<svg');
    // A product with a real photo has only that photo: no drawing to fade in over it on hover.
    const overPhotos = await pglite.query<{ n: number }>(
      `select count(*)::int as n from public.product_images d
        where d.image_url like '%/sample-images/%'
          and exists (select 1 from public.product_images o
                       where o.square_item_id = d.square_item_id and o.image_url not like '%/sample-images/%')`,
    );
    expect(overPhotos.rows[0].n).toBe(0);
    await pglite.close();
  });
});

describe('tidySamplePictures', () => {
  it('removes drawings that older seeds put after a real photo, and nothing else', async () => {
    const { pglite } = await createDatabase();
    await seedSample(pglite, 'http://localhost:8080');
    const photo = await pglite.query<{ id: string }>(
      "select square_item_id as id from public.product_images where image_url not like '%/sample-images/%' limit 1",
    );
    const drawnOnly = await pglite.query<{ id: string }>(
      "select square_item_id as id from public.product_images where image_url like '%/sample-images/%' limit 1",
    );
    const id = photo.rows[0].id;
    const add = (item: string, url: string, sort: number) =>
      pglite.query(
        'insert into public.product_images (square_item_id, image_url, alt_text, sort_order) values ($1, $2, $3, $4)',
        [item, url, 'x', sort],
      );
    await add(id, `http://localhost:8080/sample-images/old-drawing.svg`, 1);
    // a shop's own product with a sample-looking address is never touched
    await pglite.query(
      "insert into public.catalog_products (square_item_id, name, source) values ('REALITEM1', 'Rem Figure', 'square')",
    );
    await add('REALITEM1', 'https://cdn.example.com/a.jpg', 0);
    await add('REALITEM1', 'http://localhost:8080/sample-images/b.svg', 1);
    const count = async () =>
      (await pglite.query<{ n: number }>('select count(*)::int as n from public.product_images'))
        .rows[0].n;
    const before = await count();

    expect(await tidySamplePictures(pglite)).toBe(1);
    expect(await count()).toBe(before - 1);
    const left = await pglite.query<{ image_url: string }>(
      'select image_url from public.product_images where square_item_id = $1',
      [id],
    );
    expect(left.rows.every((r) => !r.image_url.includes('/sample-images/'))).toBe(true);
    // a sample product whose only picture is its drawing keeps it
    const kept = await pglite.query<{ n: number }>(
      'select count(*)::int as n from public.product_images where square_item_id = $1',
      [drawnOnly.rows[0].id],
    );
    expect(kept.rows[0].n).toBe(1);
    expect(await tidySamplePictures(pglite)).toBe(0);
    await pglite.close();
  });
});

describe('frameSamplePortraits', () => {
  it('zooms every sample portrait past its black edges once, and leaves a frame someone set alone', async () => {
    const { pglite } = await createDatabase();
    await seedSample(pglite, 'http://localhost:8080');
    const portraits = await pglite.query<{ n: number }>(
      "select count(*)::int as n from public.product_images where image_url like 'https://www.thiswaifudoesnotexist.net/%'",
    );
    const frames = await pglite.query<{ n: number; zooms: number[] }>(
      'select count(*)::int as n, array_agg(distinct zoom) as zooms from public.photo_frames',
    );
    expect(portraits.rows[0].n).toBeGreaterThan(0);
    expect(frames.rows[0].n).toBe(portraits.rows[0].n);
    expect(frames.rows[0].zooms).toEqual([1.25]);

    const one = await pglite.query<{ id: string; url: string }>(
      'select square_item_id as id, image_url as url from public.photo_frames limit 1',
    );
    await pglite.query('update public.photo_frames set zoom = 2 where square_item_id = $1', [
      one.rows[0].id,
    ]);
    expect(await frameSamplePortraits(pglite)).toBe(0);
    const kept = await pglite.query<{ zoom: number }>(
      'select zoom from public.photo_frames where square_item_id = $1',
      [one.rows[0].id],
    );
    expect(kept.rows[0].zoom).toBe(2);
    await pglite.close();
  });
});

describe('sample glossary', () => {
  it('adds the glossary terms', async () => {
    const { pglite } = await createDatabase();
    const seeded = await seedSample(pglite, 'http://localhost:8080');
    expect(seeded.glossaryTerms).toBe(SAMPLE_GLOSSARY.length);
    const { rows } = await pglite.query<{ term: string }>(
      'select term from public.glossary_terms order by lower(term)',
    );
    expect(rows.map((r) => r.term)).toContain('Nendoroid');
    expect(rows).toHaveLength(SAMPLE_GLOSSARY.length);
    await pglite.close();
  });
});

describe('sample accounts', () => {
  it('are mostly customers, each with past orders, favourites and an address', async () => {
    const { pglite } = await createDatabase();
    await seedSample(pglite, 'http://localhost:8080');
    const made = await seedSampleAccounts(pglite, 'http://localhost:8080');
    expect(made.accounts).toBe(SAMPLE_ACCOUNTS.length);
    expect(made.orders).toBeGreaterThan(100);

    const people = (
      await pglite.query<{
        email: string;
        role: string;
        orders: number;
        favourites: number;
        homes: number;
      }>(
        `select p.email, p.role,
           (select count(*)::int from public.orders o where o.user_id = p.id) as orders,
           (select count(*)::int from public.wishlist_items w where w.user_id = p.id) as favourites,
           (select count(*)::int from public.customer_addresses a where a.user_id = p.id and a.is_default) as homes
         from public.profiles p where p.email = any($1::text[])`,
        [SAMPLE_ACCOUNTS.map(sampleAccountEmail)],
      )
    ).rows;
    expect(people).toHaveLength(SAMPLE_ACCOUNTS.length);
    expect(people.filter((p) => p.role === 'customer').length).toBeGreaterThan(people.length * 0.8);
    for (const p of people) {
      expect(p.favourites).toBeGreaterThan(0);
      expect(p.homes).toBe(1);
    }
    expect(people.filter((p) => p.orders >= 5).length).toBeGreaterThan(10);

    // the orders read like real ones: paid unless pending or cancelled, shipped ones tracked, totals add up
    const orders = (
      await pglite.query<any>(
        `select o.status, o.paid_at is not null as paid, o.tracking_number, o.total_cents, o.subtotal_cents + o.shipping_cents + o.tax_cents as sum,
           (select sum(unit_price_cents * quantity)::int from public.order_items i where i.order_id = o.id) as items,
           o.subtotal_cents, extract(epoch from now() - o.created_at) / 86400 as age_days, (select array_agg(event_type order by created_at) from public.order_events e where e.order_id = o.id) as events
         from public.orders o where o.user_id is not null`,
      )
    ).rows;
    for (const o of orders) {
      expect(o.paid).toBe(!['pending', 'cancelled'].includes(o.status));
      expect(o.total_cents).toBe(o.sum);
      expect(o.items).toBe(o.subtotal_cents);
      expect(o.events[0]).toBe('created');
      if (o.status === 'shipped') expect(o.tracking_number).toBeTruthy();
      // only the last few days still wait to ship ('paid' / 'fulfilled' = paid, not shipped yet)
      if (['paid', 'fulfilled'].includes(o.status)) expect(o.age_days).toBeLessThan(7);
    }
    expect(new Set(orders.map((o) => o.status)).size).toBeGreaterThanOrEqual(5);

    const restricted = (
      await pglite.query<{ n: number }>(
        'select count(*)::int as n from public.profiles where banned_at is not null or suspended_until > now()',
      )
    ).rows[0].n;
    expect(restricted).toBe(2);

    // a second start keeps what is there; --reset removes them
    expect((await seedSampleAccounts(pglite, 'http://localhost:8080')).accounts).toBe(0);
    await clearSampleAccounts(pglite);
    const left = await pglite.query<{ n: number }>(
      'select count(*)::int as n from public.orders where user_id is not null',
    );
    expect(left.rows[0].n).toBe(0);
    await pglite.close();
  });

  it('refuse a database with real (Supabase) sign-in', async () => {
    const { pglite } = await createDatabase();
    await pglite.query('alter table auth.users add column encrypted_password text');
    await expect(seedSampleAccounts(pglite, 'http://localhost:8080')).rejects.toThrow(
      'local databases only',
    );
    await pglite.close();
  });
});
