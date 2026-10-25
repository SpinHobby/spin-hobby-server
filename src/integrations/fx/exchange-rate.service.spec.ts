import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANK_OF_CANADA_USD_URL, ExchangeRateService } from './exchange-rate.service.js';

const fetchMock = vi.fn();
const bank = (v: string, d = '2026-10-23') =>
  new Response(JSON.stringify({ observations: [{ d, FXUSDCAD: { v } }] }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ExchangeRateService.cadToUsd', () => {
  it("turns the bank's CAD-per-USD figure into 1 CAD in USD", async () => {
    fetchMock.mockResolvedValue(bank('1.3993'));
    const fx = new ExchangeRateService();
    expect(await fx.cadToUsd()).toEqual({ cadUsd: 0.7146, date: '2026-10-23' });
    expect(fetchMock.mock.calls[0][0]).toBe(BANK_OF_CANADA_USD_URL);
  });

  it('serves the cached rate for 6 hours, then refreshes in the background', async () => {
    fetchMock.mockResolvedValueOnce(bank('1.4')).mockResolvedValueOnce(bank('1.25', '2026-10-24'));
    const fx = new ExchangeRateService();
    await fx.cadToUsd();
    vi.setSystemTime(new Date('2026-10-25T17:00:00Z'));
    await fx.cadToUsd();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-25T18:30:00Z'));
    expect((await fx.cadToUsd())?.cadUsd).toBe(0.7143); // the old rate, while the new one loads
    await vi.waitFor(async () => expect((await fx.cadToUsd())?.cadUsd).toBe(0.8));
  });

  it('returns null when the bank has never answered, so the Settings rate is used', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await new ExchangeRateService().cadToUsd()).toBeNull();
  });

  it('keeps the last good rate when a refresh fails, and waits before retrying', async () => {
    fetchMock.mockResolvedValueOnce(bank('1.4')).mockRejectedValue(new Error('offline'));
    const fx = new ExchangeRateService();
    await fx.cadToUsd();
    vi.setSystemTime(new Date('2026-10-25T19:00:00Z'));
    await fx.cadToUsd();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((await fx.cadToUsd())?.cadUsd).toBe(0.7143);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry within 10 minutes
  });

  it('rejects an answer without a usable rate', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ observations: [] }), { status: 200 }),
    );
    expect(await new ExchangeRateService().cadToUsd()).toBeNull();
  });
});
