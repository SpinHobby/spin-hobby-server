// ESLint 10 flat config. Run with `npm run lint` (or `npm run lint:fix` for the auto-fixable part).
// Formatting is Prettier's job (`npm run format`); this file only holds rules that catch bugs.
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Bugs that are easy to write in async Nest code.
      '@typescript-eslint/no-floating-promises': 'error', // a forgotten `await` hides failures
      '@typescript-eslint/no-misused-promises': 'error', // async function where a sync one is expected
      '@typescript-eslint/await-thenable': 'error',
      // Use Nest's Logger so output carries a context name and respects log levels.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Row types are being tightened (see src/database/rows.ts); until then `any` is a warning, not an error.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Scripts and the test harness may print and are not part of the app.
    files: ['scripts/**', 'test/**', '*.config.*'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' }, // response bodies in tests are naturally untyped
  },
  {
    // Plain JavaScript files are not in tsconfig, so skip the type-aware rules there.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier, // last: turns off any rule that would fight Prettier
);
