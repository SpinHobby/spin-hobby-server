// Fails when a branch adds a migration that is not newer than every migration already on the branch it merges into.
// The server only applies migrations newer than the newest one the database has recorded (src/database/migrations), so a
// file with an older timestamp, merged after a newer one has run, would never be applied: the code would ship without its
// table or column, and nothing would say so until /health was read. Rename the file with the current time to fix it.
//
//   node scripts/check-migration-order.mjs origin/staging
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const DIR = 'supabase/migrations';
const NAME = /^\d{14}_.+\.sql$/;
const base = process.argv[2];
if (!base) {
  console.error('Usage: node scripts/check-migration-order.mjs <base ref, e.g. origin/staging>');
  process.exit(2);
}

const onBase = execFileSync('git', ['ls-tree', '--name-only', base, `${DIR}/`], {
  encoding: 'utf8',
})
  .split('\n')
  .map((path) => path.slice(DIR.length + 1))
  .filter((file) => NAME.test(file));
const newestOnBase = onBase.sort().at(-1);
const added = readdirSync(DIR).filter((file) => NAME.test(file) && !onBase.includes(file));
const tooOld = newestOnBase
  ? added.filter((file) => file.slice(0, 14) <= newestOnBase.slice(0, 14))
  : [];

if (tooOld.length) {
  console.error(
    `These migrations are older than the newest one on ${base} (${newestOnBase}) and would never be applied:`,
  );
  for (const file of tooOld) console.error(`  ${DIR}/${file}`);
  console.error(
    'Rename each with the current time (YYYYMMDDHHMMSS_name.sql), newest last, and push again.',
  );
  process.exit(1);
}
console.log(
  `Migration order OK: ${added.length} new, all newer than ${newestOnBase ?? 'nothing'} on ${base}.`,
);
