// Pre-commit check: lint and format-check only the files being committed (fast; CI runs the full set).
// Runs the tools with this Node binary rather than `npx`, so it behaves the same on Windows, macOS and Linux.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const lintable = staged.filter(
  (f) => /\.(ts|mjs)$/.test(f) && /^(src|test|scripts)\/|^[^/]+\.mjs$/.test(f),
);
const formattable = staged.filter(
  (f) => /\.(ts|mjs|json|md)$/.test(f) && !f.startsWith('supabase/'),
);

function run(label, script, args) {
  if (!args.length) return true;
  const result = spawnSync(process.execPath, [join(root, 'node_modules', script), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) console.error(`\n  x ${label} failed.`);
  return result.status === 0;
}

const lintOk = run('Lint', 'eslint/bin/eslint.js', ['--max-warnings', '0', ...lintable]);
const formatOk = run('Format check', 'prettier/bin/prettier.cjs', ['--check', ...formattable]);

if (!lintOk || !formatOk) {
  console.error(
    '\nCommit stopped. Fix it with:  npm run lint:fix && npm run format\nThen `git add` the files and commit again.\n',
  );
  process.exit(1);
}
