import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    // Most specs hammer a few routes from one address; hardening.e2e-spec.ts turns limits back on.
    env: { THROTTLE_DISABLED: 'true' },
  },
});
