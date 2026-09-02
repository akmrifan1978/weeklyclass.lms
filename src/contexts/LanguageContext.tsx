import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, I18nManager, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { applyLanguage, isRTL, loadStoredLanguage } from '@/i18n';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredLanguage();
      if (cancelled) return;
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

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      rtl: Platform.OS === 'web' ? isRTL(language) : I18nManager.isRTL,
      available,
      ready,
      setLanguage,
    }),
    [language, available, ready, setLanguage]
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
