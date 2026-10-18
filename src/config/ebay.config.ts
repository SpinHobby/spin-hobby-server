import { env, envNumber, envUrl } from './env.js';

/**
 * eBay: the shop sells on eBay too. These are the keys of the shop's eBay developer app (developer.ebay.com -> Application keys) and its
 * "RuName" (the name eBay gives the sign-in return address). The seller account itself is connected by an owner in the admin, who signs in
 * on eBay's own page; nothing here is a seller password.
 */
export const ebayClientId = () => env('EBAY_CLIENT_ID');
export const ebayClientSecret = () => env('EBAY_CLIENT_SECRET');
export const ebayRuName = () => env('EBAY_RU_NAME');

/** `production` or `sandbox` (default sandbox): which eBay the keys belong to. */
export const ebayIsProduction = () => env('EBAY_ENVIRONMENT') === 'production';

/** The eBay site listings go on (default EBAY_CA, eBay Canada) and the currency of their prices (default CAD). */
export const ebayMarketplaceId = () => env('EBAY_MARKETPLACE_ID') ?? 'EBAY_CA';
export const ebayCurrency = () => env('EBAY_CURRENCY') ?? 'CAD';

/**
 * Encrypts the seller's eBay tokens at rest: any long random string (`openssl rand -base64 32`). Without it eBay cannot be connected: the
 * tokens let anyone act as the seller.
 */
export const ebayTokenKey = () => env('EBAY_TOKEN_KEY');

/** Where the admin is, to send the owner back after signing in on eBay (default: STOREFRONT_URL + /admin). */
export const ebayAdminReturnUrl = () => envUrl('EBAY_ADMIN_RETURN_URL');

/**
 * eBay's "marketplace account deletion" notices (required before production keys work): the token typed into the eBay developer portal
 * (32-80 letters, digits, _ or -), and the exact address eBay calls (this server's /ebay/account-deletion).
 */
export const ebayVerificationToken = () => env('EBAY_VERIFICATION_TOKEN');
export const ebayDeletionEndpoint = () => envUrl('EBAY_DELETION_ENDPOINT');

/** How often eBay orders are checked, so an eBay sale takes the unit off Square (minutes, default 2; 0 = only when asked). */
export const ebaySyncIntervalMinutes = () => envNumber('EBAY_SYNC_INTERVAL_MINUTES', 2);

/** How often every listing's eBay quantity is compared with Square's and corrected (minutes, default 30; 0 = off). */
export const ebayReconcileIntervalMinutes = () => envNumber('EBAY_RECONCILE_INTERVAL_MINUTES', 30);

/** eBay's API and sign-in hosts for the configured environment. */
export const ebayApiBase = () =>
  ebayIsProduction() ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
export const ebayAuthBase = () =>
  ebayIsProduction() ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
/** Where a listing is seen on eBay. */
export const ebayItemUrl = (listingId: string) =>
  `${ebayIsProduction() ? 'https://www.ebay.ca' : 'https://sandbox.ebay.com'}/itm/${listingId}`;
