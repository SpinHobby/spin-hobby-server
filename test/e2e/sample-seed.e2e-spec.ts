import { describe, expect, it } from 'vitest';
import { sampleImageFor } from '../../src/modules/sample/images.js';
import { seedSample } from '../../src/modules/sample/seed.js';
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
    const pictures = await pglite.query<{ image_url: string }>(
      "select image_url from public.product_images where square_item_id = 'sample-x1'",
    );
    const drawn = pictures.rows.map((r) => r.image_url).find((u) => u.endsWith('.svg'))!;
    expect(sampleImageFor(drawn.split('/').pop()!)).toContain('<svg');
    await pglite.close();
  });
});
