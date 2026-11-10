import { env } from './env.js';

/** Resend API key and the From address. Email is skipped (not an error) when either is missing. */
export const resendApiKey = () => env('RESEND_API_KEY');
export const fromEmail = () => env('FROM_EMAIL');
/** Where shoppers' replies go (and the address in every email's footer): the shop's public support address. */
export const supportEmail = () => env('SUPPORT_EMAIL') || 'info@spinhobby.com';
