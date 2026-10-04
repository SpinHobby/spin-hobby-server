// Loads the sample catalog (src/modules/sample) into the STAGING database by hand. The staging API already
// does this itself the first time it starts against an empty catalog; use this to reload after
// changing the sample data:
//
//   STAGING_DATABASE_URL='postgresql://...' npm run seed:staging -- --replace
//
// --replace removes the previous sample set (products, their orders, banners) first. Pictures are
// served by the staging API; STAGING_API_URL overrides which host the picture URLs point at.
// Refuses to touch the production project, and without --replace refuses a catalog that has products.
import { execSync } from 'node:child_process';
import pg from 'pg';

const PRODUCTION_REF = 'zmlltsytckexrmybvnof';
const url = process.env.STAGING_DATABASE_URL;
if (!url) {
  console.error(
    "Set STAGING_DATABASE_URL to the staging project's connection string (Supabase > Connect > Session pooler).",
  );
  process.exit(1);
}
if (url.includes(PRODUCTION_REF)) {
  console.error('That connection string is the PRODUCTION database. Refusing to seed it.');
  process.exit(1);
}
const replace = process.argv.includes('--replace');
const imageBase = process.env.STAGING_API_URL ?? 'https://spin-hobby-server-staging.onrender.com';

execSync('npm run build', { stdio: 'inherit' });
const { seedSample, clearSample, countProducts } = await import('../dist/modules/sample/seed.js');

const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});
await client.connect();
try {
  const { rows } = await client.query("select to_regclass('public.catalog_products') as t");
  if (!rows[0].t)
    throw new Error(
      'The schema is missing. Start the staging API once (it applies migrations), then re-run this.',
    );
  await client.query('begin');
  if (replace) await clearSample(client);
  const existing = await countProducts(client);
  if (existing > 0)
    throw new Error(
      `The staging catalog already has ${existing} products; use --replace to swap the sample set, or clear them first.`,
    );
  const seeded = await seedSample(client, imageBase);
  await client.query('commit');
  console.log(
    `Seeded staging: ${seeded.products} products, ${seeded.categories} categories, ${seeded.orders} orders, ${seeded.slides} banners (pictures from ${imageBase}/sample-images).`,
  );
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
