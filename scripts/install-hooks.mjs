// Runs after `npm install` (the "prepare" script): points git at the shared hooks in .githooks/.
// Safe to fail: in Docker and CI there is no .git folder, and that is fine.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
if (existsSync(join(root, '.git'))) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
  } catch {
    /* git is not available: skip */
  }
}
