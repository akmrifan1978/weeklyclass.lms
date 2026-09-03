import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, I18nManager, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { applyLanguage, isRTL, loadStoredLanguage } from '@/i18n';
import {
  loadScopeLanguages,
  mergeScopeLanguages,
  saveScopeLanguage,
  type LanguageScope,
  type ScopeLanguages,
} from '@/i18n/scopes';
import { LANGUAGES } from '@/constants/app';
import { listLanguages } from '@/services/languageService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import type { AppLanguage, LanguageCode } from '@/types';

interface LanguageContextValue {
  language: LanguageCode;
  rtl: boolean;
  /** Languages an admin has enabled, falling back to the bundled set. */
  available: AppLanguage[];
  ready: boolean;
  setLanguage: (code: LanguageCode) => Promise<void>;
  /** The language a dashboard should use — its own, or the app-wide default. */
  languageFor: (scope: LanguageScope) => LanguageCode;
  /** Sets and persists one dashboard's language, and applies it immediately. */
  setLanguageFor: (scope: LanguageScope, code: LanguageCode) => Promise<void>;
  /** Preferences loaded from the profile, so they follow across devices. */
  adoptScopeLanguages: (fromProfile: ScopeLanguages | undefined) => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [available, setAvailable] = useState<AppLanguage[]>(() =>
    LANGUAGES.map((l, index) => ({
      id: l.code,
      code: l.code,
      name: l.name,
      nativeName: l.nativeName,
      rtl: l.rtl,
      enabled: true,
      order: index,
    }))
  );
  const [ready, setReady] = useState(false);
  const [scopes, setScopes] = useState<ScopeLanguages>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, storedScopes] = await Promise.all([
        loadStoredLanguage(),
        loadScopeLanguages(),
      ]);
      if (cancelled) return;
      setScopes(storedScopes);
      // Restoring is not a choice, so it must not overwrite what is stored.
      await applyLanguage(stored, { persist: false });
      setLanguageState(stored);
      setReady(true);

      // The enabled list is a nice-to-have; a failure must not block the app.
      listLanguages(true)
        .then((rows) => {
          if (!cancelled && rows.length) setAvailable(rows);
        })
        .catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback(
    async (code: LanguageCode) => {
      if (code === language) return;
      const { needsRestart } = await applyLanguage(code);
      setLanguageState(code);
      logEvent(AnalyticsEvents.languageChanged, { language: code });

      if (needsRestart && Platform.OS !== 'web') {
        // Switching between LTR and RTL only fully applies after a reload on
        // native. Rather than force-restarting the app underneath the user,
        // tell them what to expect.
        Alert.alert(
          'Restart required',
          'Please close and reopen the app to finish switching text direction.',
          [{ text: 'OK' }]
        );
      }
    },
    [language]
  );

  // A scope with no choice of its own follows the app-wide language, so nobody
  // has to configure five dashboards before the app reads the way they want.
  const languageFor = useCallback(
    (scope: LanguageScope): LanguageCode => scopes[scope] ?? language,
    [scopes, language]
  );

  const setLanguageFor = useCallback(
    async (scope: LanguageScope, code: LanguageCode) => {
      setScopes((previous) => ({ ...previous, [scope]: code }));
      await saveScopeLanguage(scope, code);
      // Applied without persisting app-wide: choosing Arabic for the Qur'an must
      // not silently switch the rest of the app to Arabic next time it opens.
      await applyLanguage(code, { persist: false });
      logEvent(AnalyticsEvents.languageChanged, { language: code, scope });
    },
    []
  );

  const adoptScopeLanguages = useCallback((fromProfile: ScopeLanguages | undefined) => {
    if (!fromProfile) return;
    setScopes((previous) => mergeScopeLanguages(previous, fromProfile));
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      rtl: Platform.OS === 'web' ? isRTL(language) : I18nManager.isRTL,
      available,
      ready,
      setLanguage,
      languageFor,
      setLanguageFor,
      adoptScopeLanguages,
    }),
    [language, available, ready, setLanguage, languageFor, setLanguageFor, adoptScopeLanguages]
  );

  // Keep i18next and local state aligned if something calls changeLanguage directly.
  useEffect(() => {
    const handler = (code: string) => setLanguageState(code as LanguageCode);
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, [i18n]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return context;
}
