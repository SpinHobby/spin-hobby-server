import { env, envList, envNumber } from './env.js';

/** Whether a setting has a value. The health check reports on settings by name. */
export { isEnvSet } from './env.js';

// ---- Which environment is this? -------------------------------------------------------------------

/** `NODE_ENV=production` on the live site. Anything else (development, test, unset) counts as not production. */
export const isProduction = () => env('NODE_ENV') === 'production';
export const isTest = () => env('NODE_ENV') === 'test';

/** `APP_ENV=staging` on the staging deployment. */
export const isStaging = () => env('APP_ENV') === 'staging';

/** What to call this environment in logs, Sentry and /health. */
export const environmentName = () => env('APP_ENV') ?? 'production';

/** True on Render, which sets `RENDER` itself. */
export const isOnRender = () => Boolean(env('RENDER'));

/** The deployed commit (Render sets it), shortened for /health. */
export const releaseVersion = () => env('RENDER_GIT_COMMIT')?.slice(0, 7) ?? null;

// ---- HTTP -----------------------------------------------------------------------------------------

/** Port the API listens on. */
export const port = () => envNumber('PORT', 8080);

/** An optional path prefix for every route (e.g. `/api`). */
export const apiPrefix = () => env('API_PREFIX');

/** Where this API is reachable from outside, used to build links to uploaded files. */
export const publicApiUrl = () => env('PUBLIC_API_URL');

/** Render's own public URL for this service (set by Render). */
export const renderExternalUrl = () => env('RENDER_EXTERNAL_URL');

/** The storefront's address, for links in emails. */
export const storefrontUrl = () => env('STOREFRONT_URL') ?? 'https://spinhobby.com';

/** A Netlify build hook for the website: when set, the API asks for a rebuild once the products shoppers see have changed. */
export const siteBuildHookUrl = () => env('SITE_BUILD_HOOK_URL');
/** At most one website rebuild this often (hours), to stay inside Netlify's build minutes. */
export const siteRebuildMinHours = () => envNumber('SITE_REBUILD_MIN_HOURS', 6);

/** Log one line per request (default on; off in tests). */
export const requestLoggingEnabled = () => !isTest() && env('LOG_REQUESTS') !== 'false';

/** Requests per minute per client before the global rate limit answers 429. */
export const rateLimitPerMinute = () => envNumber('RATE_LIMIT_PER_MINUTE', 300);

/** Turns every rate limit off (load tests, local scripts). */
export const rateLimitDisabled = () => env('THROTTLE_DISABLED') === 'true';

/**
 * Proxies between the internet and this server whose X-Forwarded-For entries we believe. On Render the header reads
 * `client, Cloudflare edge, Render's internal proxy`, so the client is three hops from the server; elsewhere assume one
 * proxy. Too low and every shopper looks like a proxy address (limits stop being per shopper); too high and callers
 * can spoof their address. Override with TRUST_PROXY_HOPS.
 */
export const trustProxyHops = () => {
  const fallback = isOnRender() ? 3 : 1;
  const hops = envNumber('TRUST_PROXY_HOPS', fallback);
  return Number.isInteger(hops) && hops >= 0 ? hops : fallback;
};

/** The interactive API docs (Swagger UI at /docs) are for developers: on locally and on staging, never in production. */
export const apiDocsEnabled = () => !isProduction() || isStaging();

/** The staging storefront and Netlify deploy previews, allowed whenever APP_ENV=staging. */
const STAGING_ORIGINS = [
  'https://spin-hobby-staging.netlify.app',
  'https://staging--spinhobby.netlify.app',
  'https://*--spinhobby.netlify.app',
];

/** Storefront origins always allowed (plus the staging ones on staging), plus ALLOWED_ORIGINS (comma separated). */
export function allowedOrigins(): string[] {
  return [
    ...new Set([
      'https://spinhobby.com',
      'https://www.spinhobby.com',
      ...(isStaging() ? STAGING_ORIGINS : []),
      ...envList('ALLOWED_ORIGINS'),
    ]),
  ];
}

/**
 * Whether a browser origin may call the API. ALLOWED_ORIGINS entries may use `*` for one
 * subdomain label, e.g. `https://*--spinhobby.netlify.app` for Netlify deploy previews.
 */
export function originAllowed(origin: string): boolean {
  return allowedOrigins().some((entry) => {
    if (!entry.includes('*')) return entry === origin;
    const pattern = entry
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[a-z0-9-]+');
    return new RegExp(`^${pattern}$`).test(origin);
  });
}

// ---- Monitoring -----------------------------------------------------------------------------------

/** Sentry error reporting is on only when this is set. */
export const sentryDsn = () => env('SENTRY_DSN');

/** The environment label Sentry groups errors under. */
export const sentryEnvironment = () => env('APP_ENV') ?? env('NODE_ENV') ?? 'production';

/** Sample catalog (staging and local): where picture URLs point, and whether auto-loading is switched off. */
export const sampleImageBase = () =>
  (
    env('SAMPLE_IMAGE_BASE') ??
    renderExternalUrl() ??
    `http://localhost:${env('PORT') ?? '8080'}`
  ).replace(/\/$/, '');
export const sampleDataDisabled = () => env('SAMPLE_DATA') === 'false';

/** Set only by `npm run dev:local`: checkout may complete with a test payment when no payment keys are set (see payments/test-payments.ts). */
export const devTestPaymentsRequested = () => env('DEV_TEST_PAYMENTS') === 'true';

// ---- The shop assistant ---------------------------------------------------------------------------

/**
 * Whether the storefront shows the talking shop assistant (answered by the shop's Gleamshelf computer, or with a text answer while it is
 * away). `SHOP_ASSISTANT=on` or `off`; on by default everywhere but the live site, where it is off until switched on. Staging runs with
 * NODE_ENV=production too, so it is told apart by APP_ENV.
 */
export const shopAssistantEnabled = () => {
  const v = env('SHOP_ASSISTANT');
  return v ? v === 'on' : !isProduction() || isStaging();
};
