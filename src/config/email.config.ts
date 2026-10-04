import { env } from './env.js';

/** Resend API key and the From address. Email is skipped (not an error) when either is missing. */
export const resendApiKey = () => env('RESEND_API_KEY');
export const fromEmail = () => env('FROM_EMAIL');
