/**
 * A JSON payload from outside (Square, PayPal, Supabase), whose shape we do not control. Reading fields off it
 * is intentionally loose; check what you need before trusting it. Rows from our own database have real types
 * in database/rows.ts instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the one place `any` is allowed for outside data
export type ExternalJson = Record<string, any>;
