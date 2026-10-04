import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SquareHttpClient } from './square-http.client.js';

const SAVED = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.SQUARE_ACCESS_TOKEN = 'sq-token';
  delete process.env.SQUARE_API_VERSION;
  delete process.env.SQUARE_ENV;
  delete process.env.SQUARE_ENVIRONMENT;
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('SquareHttpClient', () => {
  const client = new SquareHttpClient();

  it('says Square is not configured (503) when there is no access token', async () => {
    delete process.env.SQUARE_ACCESS_TOKEN;
    await expect(client.request('/v2/payments', {})).rejects.toMatchObject({
      message: 'Square is not configured.',
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs JSON to the sandbox host with the bearer token', async () => {
    fetchMock.mockResolvedValue(json({ payment: { id: 'P1' } }));
    const body = await client.request('/v2/payments', { amount: 5 });
    expect(body).toEqual({ payment: { id: 'P1' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://connect.squareupsandbox.com/v2/payments');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer sq-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({ amount: 5 });
  });

  it('uses the production host, the pinned API version and the idempotency key when given', async () => {
    process.env.SQUARE_ENVIRONMENT = 'production';
    process.env.SQUARE_API_VERSION = '2025-01-01';
    fetchMock.mockResolvedValue(json({}));
    await client.request('/v2/orders', {}, 'key-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://connect.squareup.com/v2/orders');
    expect(init.headers).toMatchObject({
      'Square-Version': '2025-01-01',
      'Idempotency-Key': 'key-1',
    });
  });

  it("turns a Square error into a 502 that carries Square's own message", async () => {
    fetchMock.mockResolvedValue(json({ errors: [{ detail: 'Card declined.' }] }, 402));
    await expect(client.request('/v2/payments', {})).rejects.toMatchObject({
      message: 'Card declined.',
      status: 502,
    });
  });

  it('uses a generic message when Square gives no reason (even for a non-JSON reply)', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 500 }));
    await expect(client.request('/v2/payments', {})).rejects.toMatchObject({
      message: 'Square rejected the request.',
      status: 502,
    });
  });
});
