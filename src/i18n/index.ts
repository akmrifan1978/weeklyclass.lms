import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import ta from './locales/ta.json';
import si from './locales/si.json';
import ar from './locales/ar.json';
import { DEFAULT_LANGUAGE, LANGUAGES, STORAGE_KEYS } from '@/constants/app';
import type { LanguageCode } from '@/types';

/**
 * Translation resources.
 *
 * Adding a language is a three-step job and needs no component changes:
 *   1. drop `xx.json` into ./locales (copy en.json and translate),
 *   2. register it here and in `LANGUAGES` (constants/app.ts),
 *   3. add the row in Firestore `languages/{code}` so admins can toggle it.
 */
export const resources = {
  en: { translation: en },
  ta: { translation: ta },
  si: { translation: si },
  ar: { translation: ar },
} as const;

export const RTL_LANGUAGES = new Set(LANGUAGES.filter((l) => l.rtl).map((l) => l.code));

export function isRTL(code: string): boolean {
  return RTL_LANGUAGES.has(code as LanguageCode);
}

function supported(code: string | undefined | null): LanguageCode {
  if (!code) return DEFAULT_LANGUAGE;
  const base = code.split('-')[0]?.toLowerCase() ?? '';
  return (LANGUAGES.find((l) => l.code === base)?.code ?? DEFAULT_LANGUAGE) as LanguageCode;
}

/** Best guess before the stored preference has loaded. */
export function deviceLanguage(): LanguageCode {
  try {
    const locales = Localization.getLocales();
    return supported(locales[0]?.languageCode ?? locales[0]?.languageTag);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnNull: false,
    // React Native has no Suspense-friendly resource loader; resources are bundled.
    react: { useSuspense: false },
  })
  .catch((error) => console.warn('[i18n] init failed', error));

/**
 * Applies a language across i18next, the document direction (web) and
 * `I18nManager` (native).
 *
 * NOTE: on native, flipping `I18nManager.isRTL` only takes full effect after an
 * app reload. `LanguageProvider` handles prompting the user; the returned flag
 * says whether a restart is needed.
 */
export async function applyLanguage(code: LanguageCode): Promise<{ needsRestart: boolean }> {
  await i18n.changeLanguage(code);
  const rtl = isRTL(code);

  try {
    await AsyncStorage.setItem(STORAGE_KEYS.language, code);
  } catch {
    // Storage is best-effort; the session language still changes.
  }

  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', code);
      document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    }
    return { needsRestart: false };
  }

  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    return { needsRestart: true };
  }
  return { needsRestart: false };
}

/** Reads the persisted language, falling back to the device locale. */
export async function loadStoredLanguage(): Promise<LanguageCode> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.language);
    if (stored) return supported(stored);
  } catch {
    // ignore
  }
  return deviceLanguage();
}

export default i18n;
