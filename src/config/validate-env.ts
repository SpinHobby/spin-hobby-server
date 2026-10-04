import { env } from './env.js';

export interface EnvProblem {
  name: string;
  message: string;
  /** Fatal problems stop the server starting; the rest are logged as warnings. */
  fatal: boolean;
}

const isUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/** [name, accepts, what a good value looks like] */
const FORMATS: [string, (value: string) => boolean, string][] = [
  ['SQUARE_ENVIRONMENT', (v) => ['production', 'sandbox'].includes(v), '"production" or "sandbox"'],
  ['SQUARE_ENV', (v) => ['production', 'sandbox'].includes(v), '"production" or "sandbox"'],
  ['PAYPAL_ENV', (v) => ['live', 'sandbox'].includes(v), '"live" or "sandbox"'],
  ['ORDER_HOLD_MINUTES', (v) => Number(v) >= 1, 'a number of minutes, 1 or more'],
  ['ORDER_EXPIRY_INTERVAL_MINUTES', (v) => Number(v) >= 0, 'a number of minutes'],
  ['SQUARE_SYNC_INTERVAL_MINUTES', (v) => Number(v) >= 0, 'a number of minutes (0 = off)'],
  ['SQUARE_SYNC_RETIRE_MAX_RATIO', (v) => Number(v) >= 0 && Number(v) <= 1, 'a number from 0 to 1'],
  ['RATE_LIMIT_PER_MINUTE', (v) => Number(v) > 0, 'a number above 0'],
  [
    'DATABASE_POOL_SIZE',
    (v) => Number.isInteger(Number(v)) && Number(v) > 0,
    'a whole number above 0',
  ],
  ['DATABASE_CONNECT_TIMEOUT_MS', (v) => Number(v) > 0, 'milliseconds, above 0'],
  [
    'TRUST_PROXY_HOPS',
    (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
    'a whole number, 0 or more',
  ],
  ['DATABASE_URL', isUrl, 'a connection URL (postgresql://user:password@host:5432/db)'],
  ['SUPABASE_URL', isUrl, 'a URL such as https://abc.supabase.co'],
  ['PUBLIC_API_URL', isUrl, 'a URL such as https://api.spinhobby.com'],
  ['STOREFRONT_URL', isUrl, 'a URL such as https://spinhobby.com'],
  ['SQUARE_WEBHOOK_URL', isUrl, 'the full URL Square calls'],
];

/**
 * Checks the settings that are present for a sensible format, so a typo shows up at start-up with a clear
 * message instead of as odd behaviour later. A missing setting is never a problem here (integrations are
 * optional, and /health reports what is not configured). Only a PORT that cannot work is fatal (DATABASE_URL is only warned about, because the database driver accepts some URLs the URL parser rejects).
 */
export function checkEnvironment(): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const add = (name: string, message: string, fatal = false) =>
    problems.push({ name, message, fatal });

  const port = env('PORT');
  if (port && !(Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) < 65536))
    add('PORT', `PORT is "${port}"; expected a port number such as 8080.`, true);

  for (const [name, accepts, expected] of FORMATS) {
    const value = env(name);
    if (value !== undefined && !accepts(value))
      add(name, `${name} is "${value}"; expected ${expected}. The default is used instead.`);
  }

  if (env('SQUARE_ACCESS_TOKEN') && !env('SQUARE_LOCATION_ID'))
    add(
      'SQUARE_LOCATION_ID',
      'SQUARE_ACCESS_TOKEN is set but SQUARE_LOCATION_ID is not; checkout and sync need both.',
    );
  if (env('NODE_ENV') === 'production' && env('AUTH_DEV_LOGIN') === 'true')
    add('AUTH_DEV_LOGIN', 'AUTH_DEV_LOGIN=true is ignored in production.');

  return problems;
}

/** Called once at start-up: logs warnings and throws if any problem is fatal. */
export function validateEnvironment(warn: (message: string) => void): void {
  const problems = checkEnvironment();
  for (const p of problems) if (!p.fatal) warn(p.message);
  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length)
    throw new Error(`Invalid configuration:\n${fatal.map((p) => `  - ${p.message}`).join('\n')}`);
}
