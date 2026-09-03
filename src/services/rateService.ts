import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppError } from '@/utils/errors';

/**
 * Live gold, silver and currency rates, for the zakat calculator.
 *
 * Two free, key-less sources — the standing no-billing constraint on this
 * project:
 *   api.gold-api.com     spot gold and silver, in USD per troy ounce
 *   open.er-api.com      USD to 160-odd currencies, updated daily
 *
 * IMPORTANT, and surfaced in the UI: these are INTERNATIONAL SPOT prices. What a
 * jeweller pays for second-hand gold in Colombo or Jeddah is not the spot price,
 * and zakat is properly reckoned on what the holding is actually worth where the
 * person is. So a fetched rate only ever pre-fills the field — it is never
 * locked, and typing over it is the expected thing to do, not a correction.
 *
 * Nothing about the user is sent. Both requests are anonymous reads of a public
 * price feed, with no account, no key and no identifying parameter.
 */

const GOLD_ENDPOINT = 'https://api.gold-api.com/price';
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const CACHE_KEY = '@weeklyclass/rates';
const TIMEOUT_MS = 15_000;

/** Grams in a troy ounce, which is how metals are quoted. */
export const GRAMS_PER_TROY_OUNCE = 31.1034768;

/**
 * How long a cached quote is served before refetching.
 *
 * Metal prices move through the day, but not enough to change a zakat decision
 * hour to hour, and the FX feed only updates daily. Six hours keeps the figure
 * current without hammering a free service someone else pays for.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface Rates {
  /** USD per troy ounce. */
  goldUsdPerOunce: number;
  silverUsdPerOunce: number;
  /** Units of each currency per 1 USD. */
  fx: Record<string, number>;
  /** When the metal quote was taken, as reported by the source. */
  metalsAsOf: string;
  fxAsOf: string;
  /** When this app fetched it. */
  fetchedAt: string;
  /** True when served from the cache rather than the network. */
  cached?: boolean;
}

interface MetalResponse {
  price?: number;
  updatedAt?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return (await response.json()) as T;
  } finally {
    clearTimeout(deadline);
  }
}

async function readCache(): Promise<Rates | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Rates) : null;
  } catch {
    return null;
  }
}

/**
 * Current rates, from the cache when it is fresh enough.
 *
 * A stale cache is returned rather than an error when the network fails, with
 * `cached` set so the screen can say the figure is old. A slightly old gold
 * price someone can see and correct is far more useful than an empty field.
 */
export async function getRates(options: { force?: boolean } = {}): Promise<Rates> {
  const cached = await readCache();

  if (!options.force && cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (Number.isFinite(age) && age < CACHE_TTL_MS) return { ...cached, cached: true };
  }

  try {
    const [gold, silver, fx] = await Promise.all([
      fetchJson<MetalResponse>(`${GOLD_ENDPOINT}/XAU`),
      fetchJson<MetalResponse>(`${GOLD_ENDPOINT}/XAG`),
      fetchJson<{
        result?: string;
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      }>(FX_ENDPOINT),
    ]);

    if (!gold.price || !silver.price || !fx.rates?.USD) {
      throw new AppError('errors.generic', 'rates/malformed');
    }

    const rates: Rates = {
      goldUsdPerOunce: gold.price,
      silverUsdPerOunce: silver.price,
      fx: fx.rates,
      metalsAsOf: gold.updatedAt ?? new Date().toISOString(),
      fxAsOf: fx.time_last_update_utc ?? '',
      fetchedAt: new Date().toISOString(),
    };

    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(rates)).catch(() => undefined);
    return rates;
  } catch (error) {
    if (cached) return { ...cached, cached: true };
    throw error instanceof AppError
      ? error
      : new AppError('errors.networkUnavailable', 'rates/unreachable');
  }
}

/** Price of one gram in `currency`, from a USD-per-ounce spot quote. */
export function perGram(
  usdPerOunce: number,
  currency: string,
  fx: Record<string, number>
): number {
  const rate = fx[currency];
  if (!rate || !usdPerOunce) return 0;
  return (usdPerOunce / GRAMS_PER_TROY_OUNCE) * rate;
}

/**
 * Currencies to offer, ordered so the ones this app's users actually hold come
 * first, then everything else alphabetically. A Sri Lankan or Gulf user should
 * not have to scroll past a hundred codes to reach their own.
 */
const PRIORITY = ['LKR', 'INR', 'SAR', 'AED', 'QAR', 'KWD', 'OMR', 'BHD', 'MYR', 'USD', 'GBP', 'EUR'];

export function currencyOptions(fx: Record<string, number>): string[] {
  const available = Object.keys(fx).sort();
  const priority = PRIORITY.filter((code) => code in fx);
  return [...priority, ...available.filter((code) => !priority.includes(code))];
}
