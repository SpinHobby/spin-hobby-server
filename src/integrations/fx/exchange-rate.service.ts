import { Injectable, Logger } from '@nestjs/common';

/** Bank of Canada's daily average US dollar rate (Valet API: free, no key). The value is Canadian dollars per US dollar. */
export const BANK_OF_CANADA_USD_URL =
  'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
/** How long a fetched rate is used before asking again (the bank publishes once per business day). */
const FRESH_MS = 6 * 60 * 60 * 1000;
/** After a failed fetch, wait this long before trying again, so a bank outage doesn't slow every shop page. */
const RETRY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 3000;

export interface LiveRate {
  /** 1 CAD in US dollars, rounded to 4 places (e.g. 0.7146). */
  cadUsd: number;
  /** The bank's date for this rate (YYYY-MM-DD). */
  date: string;
}

/**
 * The live CAD→USD rate for the shop's "≈ US$" estimates. Shoppers never wait on the bank: the first call fetches (3 s at most), later
 * calls get the cached rate at once and refresh it in the background once it's 6 hours old. When the bank can't be reached it keeps
 * the last good rate; `null` means there has never been one, and callers fall back to the rate set in Settings.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private rate: LiveRate | null = null;
  private fetchedAt = 0;
  private failedAt = 0;
  private inFlight: Promise<void> | null = null;

  async cadToUsd(): Promise<LiveRate | null> {
    const now = Date.now();
    const stale = now - this.fetchedAt > FRESH_MS && now - this.failedAt > RETRY_MS;
    if (stale) {
      const refresh = this.refresh();
      if (!this.rate) await refresh; // first time: wait briefly; afterwards: serve the cached rate while it refreshes
    }
    return this.rate;
  }

  private refresh() {
    this.inFlight ??= this.fetchRate()
      .then((rate) => {
        this.rate = rate;
        this.fetchedAt = Date.now();
      })
      .catch((error: Error) => {
        this.failedAt = Date.now();
        this.logger.warn(
          `Bank of Canada rate unavailable (${error.message}); using ${this.rate ? 'the last rate' : 'the Settings rate'}`,
        );
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async fetchRate(): Promise<LiveRate> {
    const response = await fetch(BANK_OF_CANADA_USD_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      observations?: { d?: string; FXUSDCAD?: { v?: string } }[];
    };
    const latest = body.observations?.at(-1);
    const cadPerUsd = Number(latest?.FXUSDCAD?.v);
    if (!latest?.d || !(cadPerUsd > 0)) throw new Error('unexpected response');
    return { cadUsd: Math.round((1 / cadPerUsd) * 10000) / 10000, date: latest.d };
  }
}
