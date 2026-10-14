import { useEffect, useState } from 'react';

import { watchSettings } from '@/services/settingsService';
import { scholarsFrom, usableBannerItems } from '@/utils/branding';
import type { AppSettings, BannerItem, LogoShape, QaScholar } from '@/types';

/**
 * The branding settings, live, shared by every screen that needs them.
 *
 * ONE listener for the whole app rather than one per component. A logo appears
 * on a dozen cards on one screen, and each opening its own settings listener
 * would be a dozen subscriptions to the same document. Here the first component
 * to ask starts a single subscription, and every other one reads what it last
 * delivered.
 *
 * The subscription is deliberately never stopped: settings are needed for as
 * long as the app is open, and restarting it every time the last logo scrolled
 * off screen would cost a read each time for nothing.
 */

export interface Branding {
  logoUrl: string | null;
  /**
   * The poster to show for a video that has none of its own.
   *
   * The setting existed and only pre-filled the upload form, so a video saved
   * without a picture showed a grey placeholder for ever after - which is the
   * one case the setting is named for.
   */
  defaultThumbnail: string | null;
  /** Null until an admin picks one, which leaves every logo as it was. */
  logoShape: LogoShape | null;
  bannerItems: BannerItem[];
  scholars: QaScholar[];
}

function toBranding(settings: AppSettings): Branding {
  return {
    logoUrl: settings.logoUrl?.trim() || null,
    defaultThumbnail: settings.thumbnailUrl?.trim() || null,
    logoShape: settings.logoShape ?? null,
    bannerItems: usableBannerItems(settings.bannerItems),
    scholars: scholarsFrom(settings),
  };
}

let current: Branding = {
  logoUrl: null,
  defaultThumbnail: null,
  logoShape: null,
  bannerItems: [],
  scholars: [],
};
const listeners = new Set<(value: Branding) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  watchSettings((settings) => {
    current = toBranding(settings);
    listeners.forEach((listener) => listener(current));
  });
}

export function useBranding(): Branding {
  const [value, setValue] = useState<Branding>(current);

  useEffect(() => {
    start();
    listeners.add(setValue);
    // Whatever arrived between the first render and this effect.
    setValue(current);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
