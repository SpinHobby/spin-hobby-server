import { env } from './env.js';

export const paypalClientId = () => env('PAYPAL_CLIENT_ID');
export const paypalClientSecret = () => env('PAYPAL_CLIENT_SECRET');
export const paypalWebhookId = () => env('PAYPAL_WEBHOOK_ID');

/** `PAYPAL_ENV=live` for real money; anything else is the PayPal sandbox. */
export const paypalIsLive = () => env('PAYPAL_ENV') === 'live';

export const paypalBaseUrl = () =>
  paypalIsLive() ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
