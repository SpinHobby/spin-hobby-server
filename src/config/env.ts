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

export const squareEnvIsProduction = () => (env('SQUARE_ENV') ?? env('SQUARE_ENVIRONMENT')) === 'production';
export const paypalIsLive = () => env('PAYPAL_ENV') === 'live';

/** Storefront origins always allowed, plus ALLOWED_ORIGINS (comma separated). */
export function allowedOrigins(): string[] {
  return [...new Set(['https://spinhobby.com', 'https://www.spinhobby.com', ...envList('ALLOWED_ORIGINS')])];
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
