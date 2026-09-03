import { useCallback } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { saveDashboardLanguage } from '@/services/userService';
import type { LanguageScope } from '@/i18n/scopes';
import type { LanguageCode } from '@/types';

/**
 * Reads and sets one dashboard's language.
 *
 * This does NOT apply the language — `ScopeLanguageSync` in the root layout does
 * that from the current route, so every screen in a dashboard is covered rather
 * than only the ones that call this hook. Applying it here as well would mean a
 * screen deep inside a section could quietly override the section it sits in.
 */
export function useLanguageScope(scope: LanguageScope): {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => Promise<void>;
} {
  const { languageFor, setLanguageFor } = useLanguage();
  const { user } = useAuth();
  const language = languageFor(scope);

  const setLanguage = useCallback(
    async (code: LanguageCode) => {
      await setLanguageFor(scope, code);
      // Mirrored onto the profile so the choice follows to another device.
      // Fire-and-forget and failure-tolerant: the device copy is what this
      // screen actually reads, so a refused or offline write costs nothing.
      if (user?.uid) void saveDashboardLanguage(user.uid, scope, code);
    },
    [scope, setLanguageFor, user?.uid]
  );

  return { language, setLanguage };
}
