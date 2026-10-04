import { env } from './env.js';

/** The cashier's photo identification needs one of these. */
export const anthropicConfigured = () =>
  Boolean(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN'));
