import { env } from './env.js';

/** EasyPost API key (test keys start with EZTK, live with EZAK): live courier rates at checkout. Without it, flat shipping prices. */
export const easypostApiKey = () => env('EASYPOST_API_KEY');
