import { describe, expect, it } from 'vitest';
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
});
