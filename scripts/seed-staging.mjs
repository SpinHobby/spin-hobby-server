// Loads the sample catalog (categories, products, a few orders) into the STAGING database so
// there is something to test against. Run once after the staging API has started (it applies
// the schema on start):
//
//   STAGING_DATABASE_URL='postgresql://...' npm run seed:staging
//
// Refuses to touch the production project, and refuses a database that already has products.
import pg from 'pg';
import { seedSample } from './seed-data.mjs';

const PRODUCTION_REF = 'zmlltsytckexrmybvnof';
const url = process.env.STAGING_DATABASE_URL;
if (!url) {
  console.error('Set STAGING_DATABASE_URL to the staging project\'s connection string (Supabase > Connect > Session pooler).');
  process.exit(1);
}
if (url.includes(PRODUCTION_REF)) {
  console.error('That connection string is the PRODUCTION database. Refusing to seed it.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query("select to_regclass('public.catalog_products') as t");
  if (!rows[0].t) throw new Error('The schema is missing. Start the staging API once (it applies migrations), then re-run this.');
  const existing = await client.query('select count(*)::int as n from public.catalog_products');
  if (existing.rows[0].n > 0) throw new Error(`The staging catalog already has ${existing.rows[0].n} products; not adding sample data on top.`);

  await client.query('begin');
  const seeded = await seedSample(client);
  await client.query('commit');
  console.log(`Seeded staging: ${seeded.products} products, ${seeded.categories} categories, ${seeded.orders} orders.`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
