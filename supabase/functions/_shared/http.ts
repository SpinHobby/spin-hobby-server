export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function configuredOrigins() {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || configuredOrigins().includes(origin);
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin');
  const allowed = configuredOrigins();
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function response(req: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function failure(req: Request, message: string, status = 400, code?: string) {
  return response(req, { success: false, error: message, ...(code ? { code } : {}) }, status);
}

export async function bodyAsJson(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new Error('Expected an application/json request body.');
  const body = await req.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
  return body as Record<string, unknown>;
}

export function stringValue(value: unknown, field: string, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, maxLength = 500) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new Error('Invalid text value.');
  return value.trim();
}

export function positiveInteger(value: unknown, field: string, max = 99) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${field} must be between 1 and ${max}.`);
  return number;
}

export function safeLike(value: string) {
  return value.replace(/[,%().]/g, '').slice(0, 100);
}

export function parseRoute(pathname: string, functionName: string) {
  const marker = `/${functionName}`;
  const index = pathname.indexOf(marker);
  if (index < 0) return '/';
  const path = pathname.slice(index + marker.length);
  return path || '/';
}
