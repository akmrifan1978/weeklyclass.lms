import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppError } from '@/utils/errors';

/**
 * Prayer times, from the Aladhan API.
 *
 * Chosen because it is free, needs no key and no billing, which is the standing
 * constraint on this project. Times are cached per city per day, so opening the
 * screen again — or opening it with no connection — costs nothing and still
 * shows today's times.
 *
 * Nothing here is user data and nothing is sent anywhere but the city name, so
 * this makes no request that carries anything about who is asking.
 */

const ENDPOINT = 'https://api.aladhan.com/v1/timingsByCity';
const CACHE_PREFIX = '@weeklyclass/prayer/';
const TIMEOUT_MS = 15_000;

/** The five obligatory prayers, in order. Sunrise is shown but is not one. */
export const PRAYER_ORDER = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

export type PrayerName = (typeof PRAYER_ORDER)[number];

export interface PrayerTime {
  name: PrayerName;
  /** 24-hour "HH:mm", as returned for the requested city. */
  time: string;
}

export interface PrayerDay {
  timings: PrayerTime[];
  sunrise: string;
  readableDate: string;
  hijri: string;
  city: string;
  /** True when this came from the cache rather than the network. */
  cached?: boolean;
}

interface AladhanResponse {
  code?: number;
  data?: {
    timings?: Record<string, string>;
    date?: {
      readable?: string;
      hijri?: { date?: string; month?: { en?: string }; year?: string; day?: string };
    };
  };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Aladhan returns times like "04:53 (+03)". Only the clock time is wanted; the
 * offset is already applied and repeating it in the UI is noise.
 */
function clockOnly(value: string): string {
  return value.split(' ')[0] ?? value;
}

function parse(payload: AladhanResponse, city: string): PrayerDay {
  const timings = payload.data?.timings;
  if (!timings) throw new AppError('errors.generic', 'prayer/malformed');

  const hijriParts = payload.data?.date?.hijri;
  const hijri = hijriParts
    ? `${hijriParts.day ?? ''} ${hijriParts.month?.en ?? ''} ${hijriParts.year ?? ''} AH`.trim()
    : '';

  return {
    timings: PRAYER_ORDER.map((name) => ({ name, time: clockOnly(timings[name] ?? '') })),
    sunrise: clockOnly(timings.Sunrise ?? ''),
    readableDate: payload.data?.date?.readable ?? '',
    hijri,
    city,
  };
}

/**
 * Today's prayer times for a city.
 *
 * `method` is the calculation convention. 3 is the Muslim World League, a
 * reasonable default across the regions this app serves; Gulf users often prefer
 * Umm al-Qura (4) and South Asia the University of Karachi (1).
 */
export async function getPrayerTimes(params: {
  city: string;
  country: string;
  method?: number;
}): Promise<PrayerDay> {
  const city = params.city.trim();
  if (!city) throw new AppError('prayer.cityRequired', 'prayer/no-city');

  const cacheKey = `${CACHE_PREFIX}${todayKey()}/${city.toLowerCase()}`;

  const query = new URLSearchParams({
    city,
    country: params.country,
    method: String(params.method ?? 3),
  });

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}?${query.toString()}`, {
      signal: controller.signal,
    });
    const payload = (await response.json()) as AladhanResponse;
    const day = parse(payload, city);
    void AsyncStorage.setItem(cacheKey, JSON.stringify(day)).catch(() => undefined);
    return day;
  } catch (error) {
    // A cached day is far better than an error screen, and prayer times for a
    // given city and date do not change.
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached) return { ...(JSON.parse(cached) as PrayerDay), cached: true };
    throw error instanceof AppError
      ? error
      : new AppError('errors.networkUnavailable', 'prayer/unreachable');
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Which prayer is next, and how long until it.
 *
 * Returns null after Isha — the next prayer is tomorrow's Fajr, and counting
 * down to it across midnight would need tomorrow's times, which is more request
 * than the answer is worth.
 */
export function nextPrayer(
  day: PrayerDay,
  now: Date = new Date()
): { name: PrayerName; time: string; minutesAway: number } | null {
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (const entry of day.timings) {
    const [hours, minutes] = entry.time.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) continue;
    const at = hours * 60 + minutes;
    if (at > minutesNow) {
      return { name: entry.name, time: entry.time, minutesAway: at - minutesNow };
    }
  }
  return null;
}
