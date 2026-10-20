import {
  devTestPaymentsRequested,
  isOnRender,
  isProduction,
  isStaging,
} from '../../config/app.config.js';
import { paypalClientId, paypalClientSecret } from '../../config/paypal.config.js';
import {
  squareAccessToken,
  squareApplicationId,
  squareLocationId,
} from '../../config/square.config.js';

/**
 * Test payments: checkout without any payment keys, for a local copy of the shop (an intern's computer). The order is created and completed as a
 * real payment would complete it (stock, status, confirmation), but no money is asked for or moved. Only `npm run dev:local` turns it on
 * (DEV_TEST_PAYMENTS=true), and never where it could be the real shop: not with NODE_ENV=production, not on staging, not on Render.
 */
export const testPaymentsAllowed = () =>
  devTestPaymentsRequested() && !isProduction() && !isStaging() && !isOnRender();

/** Whether the shop's payment provider has the keys it needs. */
export const providerReady = (provider: string) =>
  provider === 'square'
    ? !!(squareAccessToken() && squareLocationId() && squareApplicationId())
    : !!(paypalClientId() && paypalClientSecret());

/** Test payments are used when they are allowed and the real provider has no keys (keys for a sandbox mean the sandbox is used). */
export const testPaymentsActive = (provider: string) =>
  testPaymentsAllowed() && !providerReady(provider);
