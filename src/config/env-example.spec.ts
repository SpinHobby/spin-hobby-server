import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every setting the server reads must be explained in .env.example, so newcomers can find it. */
describe('.env.example', () => {
  const dir = import.meta.dirname;
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
  const used = new Set(
    [...sources.matchAll(/env(?:List|Number|Url)?\('([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]),
  );
  const example = readFileSync(join(dir, '..', '..', '.env.example'), 'utf8');

  it('finds the settings in src/config', () => {
    expect(used.size).toBeGreaterThan(40);
  });

  it.each([...used].sort())('mentions %s', (name) => {
    expect(example).toContain(name);
  });
});
