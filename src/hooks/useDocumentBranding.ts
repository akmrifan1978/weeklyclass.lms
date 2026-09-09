import { useEffect } from 'react';
import { Platform } from 'react-native';

import { APP_NAME } from '@/constants/app';
import { watchSettings } from '@/services/settingsService';

/**
 * Puts the organisation's own identity on the browser tab.
 *
 * The header logo, the sign-in page and the public site all read the setting
 * live already. The tab did not: its icon and its title were baked into the
 * exported HTML, so an admin who uploaded a logo saw it everywhere inside the
 * app and nowhere in the browser — which is the one place a second tab is told
 * apart from the first.
 *
 * A live subscription rather than a one-off read, so changing the logo updates
 * every tab that happens to be open rather than waiting for a reload.
 *
 * WHAT THIS CANNOT REACH. An installed app's icon on a phone's home screen is
 * copied by the operating system at install time from the web manifest, and
 * nothing a running page does will change it — the person has to remove the app
 * and add it again. The manifest is a static file for the same reason: it is
 * read before any of this code exists. So the tab follows the setting, and the
 * installed icon follows the last install.
 */
export function useDocumentBranding(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    /** Finds the icon link, or makes one — the export does not always ship it. */
    const iconLink = (rel: string): HTMLLinkElement => {
      const existing = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (existing) return existing;
      const created = document.createElement('link');
      created.rel = rel;
      document.head.appendChild(created);
      return created;
    };

    return watchSettings((settings) => {
      const name = settings.appName?.trim();
      if (name) document.title = name;
      else document.title = APP_NAME;

      // The favicon setting when there is one, the logo when there is not: an
      // admin who has uploaded a logo and never thought about favicons should
      // still get their mark on the tab rather than the placeholder book.
      const icon = settings.faviconUrl?.trim() || settings.logoUrl?.trim();
      if (!icon) return;

      iconLink('icon').href = icon;
      iconLink('apple-touch-icon').href = icon;
    });
  }, []);
}
