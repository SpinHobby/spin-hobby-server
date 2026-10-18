import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import {
  ebayApiBase,
  ebayAuthBase,
  ebayClientId,
  ebayClientSecret,
  ebayIsProduction,
  ebayMarketplaceId,
  ebayRuName,
} from '../../config/ebay.config.js';
import { Db } from '../../database/db.service.js';
import { openToken, sealToken } from './token-crypto.js';

/** What the shop's eBay app may do for the seller: listings and stock, business policies, orders, and the account's name. */
export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
];

/** eBay's content language for the marketplace (it must match the site a listing goes on). */
export const contentLanguage = (marketplaceId = ebayMarketplaceId()) =>
  ({ EBAY_CA: 'en-CA', EBAY_US: 'en-US', EBAY_GB: 'en-GB', EBAY_AU: 'en-AU' })[marketplaceId] ??
  'en-US';

interface TokenAnswer {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/** An eBay error, with eBay's own words for a person (and its error ids for the code). */
export class EbayError extends AppError {
  constructor(
    message: string,
    readonly ebayStatus: number,
    readonly errorIds: number[] = [],
  ) {
    super(message, ebayStatus === 401 ? 409 : 502);
  }
}

const describe = (body: unknown, status: number): EbayError => {
  const errors = (
    (body as { errors?: { errorId?: number; message?: string; longMessage?: string }[] })?.errors ??
    []
  ).filter(Boolean);
  const words = errors
    .map((e) => e.longMessage || e.message)
    .filter(Boolean)
    .join(' ');
  return new EbayError(
    `eBay said: ${words || `request failed (${status})`}`,
    status,
    errors.map((e) => Number(e.errorId)).filter(Number.isFinite),
  );
};

/**
 * eBay's REST APIs for one seller account: signing in (the owner approves the shop's app on eBay's own page), the user token (refreshed
 * before it expires and saved encrypted), and the calls the shop makes. The token belongs to the connected account in `ebay_connection`.
 */
@Injectable()
export class EbayClient {
  private refreshing: Promise<string> | null = null;

  constructor(private readonly db: Db) {}

  configured(): boolean {
    return !!(ebayClientId() && ebayClientSecret() && ebayRuName());
  }

  private assertConfigured() {
    if (!this.configured())
      throw new AppError(
        'eBay is not set up on the server (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME).',
        503,
      );
  }

  /** The address of eBay's sign-in page: the owner approves the shop's app there, and eBay sends them back with a code. */
  authorizeUrl(state: string): string {
    this.assertConfigured();
    const q = new URLSearchParams({
      client_id: ebayClientId()!,
      redirect_uri: ebayRuName()!,
      response_type: 'code',
      scope: EBAY_SCOPES.join(' '),
      state,
      prompt: 'login',
    });
    return `${ebayAuthBase()}/oauth2/authorize?${q.toString()}`;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenAnswer> {
    this.assertConfigured();
    const res = await fetch(`${ebayApiBase()}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${ebayClientId()}:${ebayClientSecret()}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!res) throw new AppError('eBay could not be reached. Try again in a moment.', 502);
    const body = (await res.json().catch(() => ({}))) as TokenAnswer & {
      error_description?: string;
    };
    if (!res.ok || !body.access_token)
      throw new EbayError(
        `eBay refused the sign-in: ${body.error_description ?? res.status}`,
        res.status,
      );
    return body;
  }

  /** Trades the code eBay sent back for the seller's tokens. */
  exchangeCode(code: string): Promise<TokenAnswer> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ebayRuName()!,
    });
  }

  /** A user token valid for at least five more minutes: the stored one, or a fresh one from the refresh token (saved encrypted). */
  async accessToken(): Promise<string> {
    const row = await this.db.one<{
      access_token: string;
      access_expires_at: string;
      refresh_token: string;
      refresh_expires_at: string | null;
    }>(
      'select access_token, access_expires_at, refresh_token, refresh_expires_at from public.ebay_connection where id = 1',
    );
    if (!row)
      throw new AppError('eBay is not connected. An owner can connect it in Settings.', 409);
    if (Date.parse(row.access_expires_at) - Date.now() > 5 * 60_000)
      return openToken(row.access_token);
    if (row.refresh_expires_at && Date.parse(row.refresh_expires_at) < Date.now())
      throw new AppError(
        'The eBay connection has expired. An owner needs to connect eBay again in Settings.',
        409,
      );
    // one refresh at a time, however many calls need a token
    this.refreshing ??= (async () => {
      const fresh = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: openToken(row.refresh_token),
        scope: EBAY_SCOPES.join(' '),
      });
      await this.db.exec(
        'update public.ebay_connection set access_token = $1, access_expires_at = $2 where id = 1',
        [
          sealToken(fresh.access_token),
          new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
        ],
      );
      return fresh.access_token;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** One call to eBay as the seller. A body is JSON; 204 gives null. eBay's errors become an `EbayError` in eBay's own words. */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    options: { token?: string; base?: string; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const token = options.token ?? (await this.accessToken());
    const res = await fetch(`${options.base ?? ebayApiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Language': contentLanguage(),
        'Accept-Language': contentLanguage(),
        'X-EBAY-C-MARKETPLACE-ID': ebayMarketplaceId(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!res) throw new AppError('eBay could not be reached. Try again in a moment.', 502);
    if (res.status === 204) return null as T;
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw describe(parsed, res.status);
    return parsed as T;
  }

  // ---- the account ----------------------------------------------------------------------------------------------------------------------

  /** The signed-in seller's eBay user name. */
  async username(token?: string): Promise<string | null> {
    const base = ebayIsProduction() ? 'https://apiz.ebay.com' : 'https://apiz.sandbox.ebay.com';
    const me = await this.request<{ username?: string }>(
      'GET',
      '/commerce/identity/v1/user/',
      undefined,
      { token, base },
    ).catch(() => null);
    return me?.username ?? null;
  }

  /** The seller's business policies on the marketplace (shipping, payment, returns). */
  async policies() {
    const m = encodeURIComponent(ebayMarketplaceId());
    const [fulfillment, payment, returns] = await Promise.all([
      this.request<{ fulfillmentPolicies?: { fulfillmentPolicyId: string; name: string }[] }>(
        'GET',
        `/sell/account/v1/fulfillment_policy?marketplace_id=${m}`,
      ),
      this.request<{ paymentPolicies?: { paymentPolicyId: string; name: string }[] }>(
        'GET',
        `/sell/account/v1/payment_policy?marketplace_id=${m}`,
      ),
      this.request<{ returnPolicies?: { returnPolicyId: string; name: string }[] }>(
        'GET',
        `/sell/account/v1/return_policy?marketplace_id=${m}`,
      ),
    ]);
    return {
      fulfillment: (fulfillment?.fulfillmentPolicies ?? []).map((p) => ({
        id: p.fulfillmentPolicyId,
        name: p.name,
      })),
      payment: (payment?.paymentPolicies ?? []).map((p) => ({
        id: p.paymentPolicyId,
        name: p.name,
      })),
      returns: (returns?.returnPolicies ?? []).map((p) => ({ id: p.returnPolicyId, name: p.name })),
    };
  }

  /** The seller's stock locations (a listing needs one: it is where an item ships from). */
  async locations() {
    const r = await this.request<{
      locations?: {
        merchantLocationKey: string;
        name?: string;
        location?: { address?: Record<string, string> };
      }[];
    }>('GET', '/sell/inventory/v1/location?limit=100');
    return (r?.locations ?? []).map((l) => ({
      key: l.merchantLocationKey,
      name: l.name ?? l.merchantLocationKey,
      address: [
        l.location?.address?.city,
        l.location?.address?.stateOrProvince,
        l.location?.address?.country,
      ]
        .filter(Boolean)
        .join(', '),
    }));
  }

  async createLocation(
    key: string,
    location: {
      name: string;
      addressLine1: string;
      city: string;
      stateOrProvince: string;
      postalCode: string;
      country: string;
    },
  ) {
    await this.request('POST', `/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
      name: location.name,
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
      location: {
        address: {
          addressLine1: location.addressLine1,
          city: location.city,
          stateOrProvince: location.stateOrProvince,
          postalCode: location.postalCode,
          country: location.country,
        },
      },
    });
  }

  // ---- categories --------------------------------------------------------------------------------------------------------------------

  private treeId: Promise<string> | null = null;

  categoryTreeId(): Promise<string> {
    this.treeId ??= this.request<{ categoryTreeId: string }>(
      'GET',
      `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(ebayMarketplaceId())}`,
    )
      .then((r) => r.categoryTreeId)
      .catch((e) => {
        this.treeId = null;
        throw e;
      });
    return this.treeId;
  }

  /** eBay's suggested categories for a title, best first, with the path to each. */
  async categorySuggestions(query: string) {
    const tree = await this.categoryTreeId();
    const r = await this.request<{
      categorySuggestions?: {
        category: { categoryId: string; categoryName: string };
        categoryTreeNodeAncestors?: { categoryName: string }[];
      }[];
    }>(
      'GET',
      `/commerce/taxonomy/v1/category_tree/${tree}/get_category_suggestions?q=${encodeURIComponent(query.slice(0, 350))}`,
    );
    return (r?.categorySuggestions ?? []).map((s) => ({
      id: s.category.categoryId,
      name: s.category.categoryName,
      path: [...(s.categoryTreeNodeAncestors ?? [])]
        .reverse()
        .map((a) => a.categoryName)
        .concat(s.category.categoryName)
        .join(' > '),
    }));
  }

  /** The item specifics a category asks for (required ones first), with eBay's suggested values. */
  async categoryAspects(categoryId: string) {
    const tree = await this.categoryTreeId();
    const r = await this.request<{
      aspects?: {
        localizedAspectName: string;
        aspectConstraint?: {
          aspectRequired?: boolean;
          aspectUsage?: string;
          aspectMode?: string;
          itemToAspectCardinality?: string;
        };
        aspectValues?: { localizedValue: string }[];
      }[];
    }>(
      'GET',
      `/commerce/taxonomy/v1/category_tree/${tree}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    );
    return (r?.aspects ?? [])
      .map((a) => ({
        name: a.localizedAspectName,
        required: !!a.aspectConstraint?.aspectRequired,
        recommended: a.aspectConstraint?.aspectUsage === 'RECOMMENDED',
        freeText: a.aspectConstraint?.aspectMode !== 'SELECTION_ONLY',
        values: (a.aspectValues ?? []).slice(0, 60).map((v) => v.localizedValue),
      }))
      .sort(
        (a, b) =>
          Number(b.required) - Number(a.required) || Number(b.recommended) - Number(a.recommended),
      );
  }

  // ---- listings ----------------------------------------------------------------------------------------------------------------------

  getInventoryItem(sku: string) {
    return this.request<Record<string, unknown>>(
      'GET',
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    );
  }

  putInventoryItem(sku: string, item: unknown) {
    return this.request(
      'PUT',
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      item,
    );
  }

  async offersFor(sku: string) {
    const r = await this.request<{
      offers?: {
        offerId: string;
        status: string;
        listing?: { listingId?: string; listingStatus?: string };
        availableQuantity?: number;
      }[];
    }>(
      'GET',
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(ebayMarketplaceId())}`,
    ).catch((e: unknown) => {
      // eBay answers "no offers" with an error
      if (e instanceof EbayError && (e.ebayStatus === 404 || e.errorIds.includes(25713)))
        return { offers: [] };
      throw e;
    });
    return r?.offers ?? [];
  }

  async createOffer(offer: unknown): Promise<string> {
    return (await this.request<{ offerId: string }>('POST', '/sell/inventory/v1/offer', offer))
      .offerId;
  }

  updateOffer(offerId: string, offer: unknown) {
    return this.request('PUT', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offer);
  }

  async publishOffer(offerId: string): Promise<string> {
    return (
      await this.request<{ listingId: string }>(
        'POST',
        `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
      )
    ).listingId;
  }

  withdrawOffer(offerId: string) {
    return this.request('POST', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`);
  }

  /** Sets the quantity of several listings at once (up to 25). Returns each SKU's outcome, so one refusal does not hide the others. */
  async setQuantities(items: { sku: string; offerId: string | null; quantity: number }[]) {
    const r = await this.request<{
      responses?: {
        sku: string;
        statusCode: number;
        errors?: { message?: string; longMessage?: string }[];
      }[];
    }>('POST', '/sell/inventory/v1/bulk_update_price_quantity', {
      requests: items.map((i) => ({
        sku: i.sku,
        shipToLocationAvailability: { quantity: i.quantity },
        ...(i.offerId ? { offers: [{ offerId: i.offerId, availableQuantity: i.quantity }] } : {}),
      })),
    });
    return (r?.responses ?? []).map((x) => ({
      sku: x.sku,
      ok: x.statusCode >= 200 && x.statusCode < 300,
      error:
        (x.errors ?? [])
          .map((e) => e.longMessage || e.message)
          .filter(Boolean)
          .join(' ') || null,
    }));
  }

  // ---- orders ------------------------------------------------------------------------------------------------------------------------

  /** Orders created or changed since `since` (eBay keeps them in pages of up to 200). */
  async ordersChangedSince(since: Date) {
    const orders: EbayOrder[] = [];
    const from = since.toISOString().replace(/\.\d{3}Z$/, '.000Z');
    for (let offset = 0; offset < 5000; offset += 200) {
      const r = await this.request<{ orders?: EbayOrder[]; total?: number }>(
        'GET',
        `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`lastmodifieddate:[${from}..]`)}&limit=200&offset=${offset}`,
      );
      orders.push(...(r?.orders ?? []));
      if (!r?.orders?.length || orders.length >= (r.total ?? 0)) break;
    }
    return orders;
  }
}

export interface EbayOrder {
  orderId: string;
  creationDate?: string;
  lastModifiedDate?: string;
  orderPaymentStatus?: string;
  cancelStatus?: { cancelState?: string };
  lineItems?: { lineItemId: string; sku?: string; quantity: number; title?: string }[];
}
