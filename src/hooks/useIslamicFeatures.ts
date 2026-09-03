import { useEffect, useState } from 'react';

import { DEFAULT_SETTINGS } from '@/constants/app';
import { watchSettings } from '@/services/settingsService';
import type { IslamicFeature } from '@/types';

/**
 * Which Islamic sections the admin has switched on.
 *
 * Watched rather than fetched once, so an admin turning a section off sees it
 * disappear from every dashboard without anyone reopening the app.
 *
 * A feature with no stored flag counts as ON. The alternative — treating a
 * missing flag as off — would hide every section on any platform whose settings
 * document predates this release, which looks like the app breaking rather than
 * like a deliberate choice.
 */
export function useIslamicFeatures(): {
  enabled: (feature: IslamicFeature) => boolean;
  ready: boolean;
} {
  const [flags, setFlags] = useState<Partial<Record<IslamicFeature, boolean>>>(
    DEFAULT_SETTINGS.islamicFeatures ?? {}
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = watchSettings((settings) => {
      setFlags(settings.islamicFeatures ?? {});
      setReady(true);
    });
    return stop;
  }, []);

  return {
    enabled: (feature) => flags[feature] !== false,
    ready,
  };
}
