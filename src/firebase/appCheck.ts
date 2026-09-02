import { Platform } from 'react-native';
import { app } from './config';

/**
 * Firebase App Check — blocks requests from clients that are not your app.
 *
 * Web: fully supported here via reCAPTCHA v3 (free). Set
 * `EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY` to enable it; when the variable is
 * empty App Check stays off so local development is not blocked.
 *
 * Native: App Check requires the native SDK (Play Integrity / App Attest) and
 * therefore an Expo Dev Build with `@react-native-firebase/app-check`. It is a
 * free feature, but it cannot run in Expo Go. See docs/SECURITY.md.
 */

let started = false;

export async function initAppCheck(): Promise<void> {
  if (started) return;
  started = true;

  const siteKey = process.env.EXPO_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY;
  if (Platform.OS !== 'web' || !siteKey) return;

  try {
    if (process.env.EXPO_PUBLIC_APPCHECK_DEBUG === 'true') {
      // Prints a debug token to the console; register it in the Firebase
      // Console under App Check -> Apps -> Manage debug tokens.
      (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    console.log('[appcheck] enabled');
  } catch (error) {
    console.warn('[appcheck] initialisation failed', error);
  }
}
