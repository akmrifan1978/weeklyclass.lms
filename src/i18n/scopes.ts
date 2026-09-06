import AsyncStorage from '@react-native-async-storage/async-storage';

import { LANGUAGES, STORAGE_KEYS } from '@/constants/app';
import type { LanguageCode } from '@/types';

/**
 * Per-dashboard language preferences.
 *
 * One language for the whole app is the wrong unit here. A teacher may run the
 * teaching side in English while reading the Qur'an in Arabic, and a student may
 * want Tamil everywhere except the Qur'an. So each dashboard remembers its own
 * choice, and entering one applies it.
 *
 * A scope with no stored choice inherits the app-wide language rather than
 * defaulting to English, so nobody has to set five preferences before the app
 * reads the way they want.
 */
export const LANGUAGE_SCOPES = [
  'admin',
  'teacher',
  'student',
  'prayer',
  'quran',
  'tajweed',
  'zakat',
  'hadith',
  'noor',
  'dua',
] as const;

export type LanguageScope = (typeof LANGUAGE_SCOPES)[number];

export type ScopeLanguages = Partial<Record<LanguageScope, LanguageCode>>;

function isScope(value: string): value is LanguageScope {
  return (LANGUAGE_SCOPES as readonly string[]).includes(value);
}

function isLanguage(value: string): value is LanguageCode {
  return LANGUAGES.some((l) => l.code === value);
}

function keyFor(scope: LanguageScope): string {
  return `${STORAGE_KEYS.language}/${scope}`;
}

/** Reads every stored scope preference in one pass. */
export async function loadScopeLanguages(): Promise<ScopeLanguages> {
  const result: ScopeLanguages = {};
  try {
    const pairs = await AsyncStorage.multiGet(LANGUAGE_SCOPES.map(keyFor));
    for (const [key, value] of pairs) {
      const scope = key.slice(key.lastIndexOf('/') + 1);
      if (value && isScope(scope) && isLanguage(value)) result[scope] = value;
    }
  } catch {
    // Storage is best-effort — an unreadable preference just means the scope
    // falls back to the app-wide language.
  }
  return result;
}

export async function saveScopeLanguage(
  scope: LanguageScope,
  code: LanguageCode
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(scope), code);
  } catch {
    // The choice still applies for this session.
  }
}

/**
 * Merges what is stored on the device with what is stored on the profile.
 *
 * The device wins. It reflects a choice made on the hardware in front of the
 * person, which is the more specific signal — someone reading on a shared tablet
 * should not have their phone's preference imposed on it.
 */
export function mergeScopeLanguages(
  device: ScopeLanguages,
  profile: ScopeLanguages | undefined
): ScopeLanguages {
  return { ...(profile ?? {}), ...device };
}

/**
 * Works out which dashboard a route belongs to.
 *
 * Deriving this from the route rather than from each screen is what makes the
 * preference hold across a whole dashboard. Binding it per screen only covered
 * the screens that remembered to ask, so walking from the Qur'an into Lessons
 * left Lessons in the Qur'an's language.
 *
 * Prayer and the Qur'an are checked first because they are sections *inside* a
 * role's area — `/(student)/quran` is the Qur'an dashboard, not the student one.
 */
export function scopeForSegments(segments: string[]): LanguageScope | null {
  if (segments.includes('quran')) return 'quran';
  if (segments.includes('prayer')) return 'prayer';
  if (segments.includes('tajweed')) return 'tajweed';
  if (segments.includes('zakat')) return 'zakat';
  if (segments.includes('hadith')) return 'hadith';
  if (segments.includes('noor')) return 'noor';
  if (segments.includes('duas')) return 'dua';
  if (segments.includes('(admin)')) return 'admin';
  if (segments.includes('(teacher)')) return 'teacher';
  if (segments.includes('(student)')) return 'student';
  return null;
}
