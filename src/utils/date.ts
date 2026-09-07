import type { AgeGroup } from '@/types';
import { Timestamp } from 'firebase/firestore';
import type { FireDate } from '@/types';

/** Normalises anything Firestore might hand back into a JS `Date`. */
export function toDate(value: FireDate | undefined | string | number): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  // Plain object shape `{ seconds, nanoseconds }` from cached/serialised docs.
  if (typeof value === 'object' && 'seconds' in value) {
    const seconds = (value as { seconds: number }).seconds;
    return new Date(seconds * 1000);
  }
  return null;
}

/** `YYYY-MM-DD` in local time (not UTC — avoids off-by-one-day bugs). */
export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM` — used to make monthly attendance reports a single query. */
export function toISOMonth(date: Date = new Date()): string {
  return toISODate(date).slice(0, 7);
}

/**
 * Combines an ISO date and `HH:mm` time into a real instant in the device
 * timezone. Calendar events store both the display strings and this value.
 */
export function combineDateTime(isoDate: string, time: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

export function formatDate(value: FireDate | string | undefined, locale = 'en'): string {
  const date = toDate(value ?? null);
  if (!date) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
}

export function formatShortDate(value: FireDate | string | undefined, locale = 'en'): string {
  const date = toDate(value ?? null);
  if (!date) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: FireDate | string | undefined, locale = 'en'): string {
  const date = toDate(value ?? null);
  if (!date) return '—';
  return `${date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} · ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Converts `HH:mm` (24h) to a localised 12h/24h label. */
export function formatTime(time: string, locale = 'en'): string {
  const [hh, mm] = time.split(':').map(Number);
  if (hh === undefined || mm === undefined) return time;
  const date = new Date();
  date.setHours(hh, mm, 0, 0);
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatTimeRange(start: string, end: string, locale = 'en'): string {
  return `${formatTime(start, locale)} - ${formatTime(end, locale)}`;
}

/** Human "in 2 hours" / "3 days ago". Returns an i18n-friendly tuple. */
export function relativeTime(
  value: FireDate | string | undefined,
  locale = 'en'
): string {
  const date = toDate(value ?? null);
  if (!date) return '—';
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < minute) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  if (abs < 365 * day) return rtf.format(Math.round(diffMs / (30 * day)), 'month');
  return rtf.format(Math.round(diffMs / (365 * day)), 'year');
}

export function isSameDay(a: Date, b: Date): boolean {
  return toISODate(a) === toISODate(b);
}

export function isFuture(value: FireDate | string | undefined): boolean {
  const date = toDate(value ?? null);
  return date ? date.getTime() > Date.now() : false;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Minutes -> "1h 25m". */
export function formatDuration(minutes?: number): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Seconds -> "MM:SS" for quiz countdown timers. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = String(Math.floor(safe / 60)).padStart(2, '0');
  const s = String(safe % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function monthLabel(isoMonth: string, locale = 'en'): string {
  const [y, m] = isoMonth.split('-').map(Number);
  if (!y || !m) return isoMonth;
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/**
 * The age band somebody falls into, from their date of birth.
 *
 * The boundaries are the ones an organiser laying tables actually uses: an
 * infant sits on a lap, a child needs a seat and a smaller meal, a teenager
 * eats like an adult and is charged like one somewhere between. They are
 * deliberately stated here once rather than guessed at each booking form.
 *
 * Null when there is no usable date — the caller decides what to do about it,
 * and defaulting silently to `adult` would quietly charge a four-year-old the
 * full price.
 */
export function ageGroupFromDateOfBirth(dateOfBirth?: string | null): AgeGroup | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  // Their birthday has not come round yet this year.
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) years -= 1;

  if (years < 0) return null;
  if (years < 3) return 'infant';
  if (years < 13) return 'child';
  if (years < 18) return 'teenage';
  return 'adult';
}
