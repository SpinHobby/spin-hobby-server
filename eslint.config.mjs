// ESLint 10 flat config. Run with `npm run lint` (or `npm run lint:fix` for the auto-fixable part).
// Formatting is Prettier's job (`npm run format`); this file only holds rules that catch bugs.
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
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
      // `${fn}` instead of `${fn()}` builds a nonsense string (it once made every sign-in token fail to verify).
      '@typescript-eslint/restrict-template-expressions': 'error',
      // `import type` for things only used as types keeps imports honest. (Classes Nest injects stay normal imports;
      // the rule knows about decorator metadata.)
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Data from outside (Square, PayPal, Supabase) is typed ExternalJson on purpose, and test responses are
      // loosely typed, so the "unsafe any" family would flag the whole boundary. Everything else in the
      // type-checked set stays on.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // Use Nest's Logger so output carries a context name and respects log levels.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Type database rows in src/database/rows.ts and outside payloads as ExternalJson; `any` stays out of the app.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Settings are read in one place. Everything else imports a named accessor from src/config
    // (e.g. `squareLocationId()` from config/square.config.ts), so the full list of settings stays discoverable.
    files: ['src/**/*.ts'],
    ignores: ['src/config/**', 'src/**/*.spec.ts'], // specs change env on purpose
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Add an accessor in src/config/ and import that instead.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/config/env.js'],
              message:
                'config/env.ts is private to src/config. Import the named accessor you need.',
            },
          ],
        },
      ],
    },
  },
  {
    // Scripts and the test harness may print and are not part of the app.
    files: ['scripts/**', 'test/**', '*.config.*'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' }, // response bodies in tests are naturally untyped
  },
  {
    // Test doubles are small fake objects: async stubs with no await, mocked methods and fetch bodies are normal there.
    files: ['test/**', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  {
    // Plain JavaScript files are not in tsconfig, so skip the type-aware rules there.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier, // last: turns off any rule that would fight Prettier
);
