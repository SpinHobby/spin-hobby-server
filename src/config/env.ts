/** Small typed accessors over process.env so every setting is read in one place. */
export function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function envList(name: string): string[] {
  return (env(name) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

export function requireEnv(name: string, feature: string): string {
  const value = env(name);
  if (!value) throw new Error(`${feature} is not configured.`);
  return value;
}

/** How long an unpaid checkout keeps its items out of other shoppers' reach. */
export const orderHoldMinutes = () => {
  const minutes = Number(env('ORDER_HOLD_MINUTES') ?? 30);
  return Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : 30;
};

/**
 * Proxies between the internet and this server whose X-Forwarded-For entries we believe. On Render the header reads
 * `client, Cloudflare edge, Render's internal proxy`, so the client is three hops from the server; elsewhere assume one
 * proxy. Too low and every shopper looks like a proxy address (limits stop being per shopper); too high and callers
 * can spoof their address. Override with TRUST_PROXY_HOPS.
 */
export const trustProxyHops = () => {
  const fallback = env('RENDER') ? 3 : 1;
  const hops = Number(env('TRUST_PROXY_HOPS') ?? fallback);
  return Number.isInteger(hops) && hops >= 0 ? hops : fallback;
};

export const squareEnvIsProduction = () => (env('SQUARE_ENV') ?? env('SQUARE_ENVIRONMENT')) === 'production';
export const paypalIsLive = () => env('PAYPAL_ENV') === 'live';

/** The staging storefront and Netlify deploy previews, allowed whenever APP_ENV=staging. */
const STAGING_ORIGINS = ['https://spin-hobby-staging.netlify.app', 'https://staging--spinhobby.netlify.app', 'https://*--spinhobby.netlify.app'];

/** Storefront origins always allowed (plus the staging ones on staging), plus ALLOWED_ORIGINS (comma separated). */
export function allowedOrigins(): string[] {
  const staging = env('APP_ENV') === 'staging' ? STAGING_ORIGINS : [];
  return [...new Set(['https://spinhobby.com', 'https://www.spinhobby.com', ...staging, ...envList('ALLOWED_ORIGINS')])];
}

/**
 * Whether a browser origin may call the API. ALLOWED_ORIGINS entries may use `*` for one
 * subdomain label, e.g. `https://*--spinhobby.netlify.app` for Netlify deploy previews.
 */
export function originAllowed(origin: string): boolean {
  return allowedOrigins().some((entry) => {
    if (!entry.includes('*')) return entry === origin;
    const pattern = entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+');
    return new RegExp(`^${pattern}$`).test(origin);
  });
}
