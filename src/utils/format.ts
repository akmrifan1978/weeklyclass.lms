import { GRADE_BANDS } from '@/constants/app';
import { phoneSearchForms } from './phone';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export function truncate(value: string, max = 120): string {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function gradeFor(percentage: number): string {
  const band = GRADE_BANDS.find((b) => percentage >= b.min);
  return band?.grade ?? 'F';
}

/** Title Case for status/enum values shown in the UI. */
export function humanise(value?: string): string {
  if (!value) return '—';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Case-insensitive local filtering used by list search boxes. */
export function matchesSearch(term: string, ...fields: (string | undefined | null)[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle));
}

/**
 * Tokens stored on user documents so Firestore can prefix-search names.
 * Firestore has no `LIKE`, so we index lowercase prefixes of each word.
 */
export function searchTokens(...values: (string | undefined | null)[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const word of value.toLowerCase().split(/[\s@._-]+/).filter(Boolean)) {
      for (let i = 1; i <= Math.min(word.length, 12); i++) {
        tokens.add(word.slice(0, i));
      }
    }
  }
  // Firestore array fields are capped at 1 MiB per document; keep it bounded.
  return Array.from(tokens).slice(0, 200);
}

/**
 * The search tokens for an account: name, username, email, generated id - and
 * the phone number in every form an admin might type it, so searching
 * "0567560387" finds the person whose number it is. It used to find nobody.
 */
export function accountSearchTokens(account: {
  fullName?: string | null;
  username?: string | null;
  email?: string | null;
  studentId?: string | null;
  teacherId?: string | null;
  mobile?: string | null;
  mobileCountryCode?: string | null;
}): string[] {
  return searchTokens(
    account.fullName,
    account.username,
    account.email,
    account.studentId ?? account.teacherId,
    ...phoneSearchForms(account.mobile, account.mobileCountryCode)
  );
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
