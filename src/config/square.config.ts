import { env } from './env.js';

export const squareAccessToken = () => env('SQUARE_ACCESS_TOKEN');
export const squareLocationId = () => env('SQUARE_LOCATION_ID');

/** Public id the browser's card form needs. */
export const squareApplicationId = () => env('SQUARE_APPLICATION_ID');

/** Pin the Square API version for the fetch-based client; unset uses the account's default. */
export const squareApiVersion = () => env('SQUARE_API_VERSION');

/**
 * The Square API version the cashier tool's catalog writes are pinned to (they call the REST endpoint directly).
 * Fixed on purpose: a new version could change how items are saved. Checkout uses `SQUARE_API_VERSION` instead.
 */
export const SQUARE_CATALOG_API_VERSION = '2025-10-16';

/** `SQUARE_ENVIRONMENT` (or the older name `SQUARE_ENV`): `production` or `sandbox` (default sandbox). */
const squareEnvironment = () => env('SQUARE_ENV') ?? env('SQUARE_ENVIRONMENT');
export const squareIsProduction = () => squareEnvironment() === 'production';
export const squareIsSandbox = () => squareEnvironment() === 'sandbox';

/** Square's REST host for the configured environment. */
export const squareBaseUrl = () =>
  squareIsProduction() ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

/** Webhook verification: the signature key from the Square dashboard, and the exact URL Square calls. */
export const squareWebhookSignatureKey = () => env('SQUARE_WEBHOOK_SIGNATURE_KEY');
export const squareWebhookUrl = () => env('SQUARE_WEBHOOK_URL');

/** Shared secret that lets a scheduled job start a catalog sync without a user session. */
export const squareSyncTriggerSecret = () => env('SQUARE_SYNC_TRIGGER_SECRET');

/** Sync on a timer every N minutes (0 or unset = only when asked). */
export const squareSyncIntervalMinutes = () => Number(env('SQUARE_SYNC_INTERVAL_MINUTES') ?? 0);

/** A sync refuses to retire more than this share of the catalog at once (guards against an empty Square response). */
export const squareSyncRetireMaxRatio = () => Number(env('SQUARE_SYNC_RETIRE_MAX_RATIO') ?? 0.5);

/**
 * The Square category that marks an item "hidden from the website" (convention one-offs that are
 * sold in person only). The default is the id of the live Spin Hobby category in Square, which is
 * why it is written here: items already carry it. Override with SQUARE_CASHIER_CATEGORY_ID when
 * pointing at a different Square account (e.g. a sandbox).
 */
export const CASHIER_CATEGORY_ID = env('SQUARE_CASHIER_CATEGORY_ID') || 'LNBIPZ6RYAMQTEZX3NF5VOGG';
