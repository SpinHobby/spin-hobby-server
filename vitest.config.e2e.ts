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
    // No Resend limits unless a spec sets them (email-limits.e2e-spec.ts), and no background retries.
    env: {
      THROTTLE_DISABLED: 'true',
      RESEND_DAILY_LIMIT: '0',
      RESEND_MONTHLY_LIMIT: '0',
      EMAIL_QUEUE_INTERVAL_MINUTES: '0',
    },
  },
});
