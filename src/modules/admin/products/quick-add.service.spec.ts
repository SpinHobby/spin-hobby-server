import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickAddService, STOCK_WAITS_MS } from './quick-add.service.js';

/** A service with only what syncUntilStock uses: the Square sync and the stock our database holds after each sync. */
function service(stockAfterEachSync: (number | null)[]) {
  let syncs = 0;
  const sync = { syncItems: vi.fn(async () => void syncs++) };
  const db = {
    one: vi.fn(async () => ({
      quantity: stockAfterEachSync[Math.min(syncs, stockAfterEachSync.length) - 1] ?? null,
    })),
  };
  const svc = new QuickAddService(
    db as never,
    {} as never,
    sync as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const wait = (stock: number | null) =>
    (
      svc as unknown as {
        syncUntilStock: (i: string, v: string, s: number | null) => Promise<void>;
      }
    ).syncUntilStock('item', 'variation', stock);
  return { sync, wait };
}

describe('adding a product: waiting for Square to count its stock', () => {
  afterEach(() => vi.useRealTimers());

  it('syncs again until the stock just set shows, instead of undoing a good item', async () => {
    vi.useFakeTimers();
    const { sync, wait } = service([0, 0, 3]);
    const done = wait(3);
    await vi.runAllTimersAsync();
    await done;
    expect(sync.syncItems).toHaveBeenCalledTimes(3);
  });

  it('syncs once when no stock was entered, or when it shows at once', async () => {
    expect(
      await (async () => {
        const s = service([0]);
        await s.wait(null);
        return s.sync.syncItems.mock.calls.length;
      })(),
    ).toBe(1);
    const s = service([2]);
    await s.wait(2);
    expect(s.sync.syncItems).toHaveBeenCalledTimes(1);
  });

  it('gives up after about 15 seconds, so the check after it still catches a real mismatch', async () => {
    vi.useFakeTimers();
    const { sync, wait } = service([0]);
    const done = wait(5);
    await vi.runAllTimersAsync();
    await done;
    expect(sync.syncItems).toHaveBeenCalledTimes(STOCK_WAITS_MS.length + 1);
    expect(STOCK_WAITS_MS.reduce((a, b) => a + b, 0)).toBe(15_000);
  });
});
