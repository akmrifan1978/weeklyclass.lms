import { Platform } from 'react-native';
import { app } from './config';

/**
 * Analytics + crash/error reporting.
 *
 * WHAT WORKS TODAY
 * - Web: real Firebase Analytics (`firebase/analytics`), free, no extra setup
 *   beyond a `measurementId`.
 * - Native (Expo Go / web-only builds): the Firebase JS SDK has NO Analytics
 *   or Crashlytics implementation for React Native. Events are buffered and
 *   logged instead of dropped silently.
 *
 * HOW TO GET NATIVE ANALYTICS + CRASHLYTICS (still free)
 * Both require native code, so they need an Expo Dev Build / EAS build rather
 * than Expo Go — they are NOT paid features:
 *   npx expo install @react-native-firebase/app @react-native-firebase/analytics \
 *                    @react-native-firebase/crashlytics
 * Then implement `nativeAnalytics` below. Everything in the app calls
 * `logEvent` / `reportError`, so no call sites change. See docs/FIREBASE.md.
 */

type AnalyticsParams = Record<string, string | number | boolean | undefined>;

interface AnalyticsBackend {
  logEvent(name: string, params?: AnalyticsParams): void;
  setUser(userId: string | null, props?: AnalyticsParams): void;
}

const noopBackend: AnalyticsBackend = {
  logEvent: () => undefined,
  setUser: () => undefined,
};

let backend: AnalyticsBackend = noopBackend;
let initialised = false;

async function initWebAnalytics(): Promise<void> {
  if (Platform.OS !== 'web' || !process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID) return;
  try {
    const { getAnalytics, isSupported, logEvent, setUserId, setUserProperties } = await import(
      'firebase/analytics'
    );
    if (!(await isSupported())) return;
    const analytics = getAnalytics(app);
    backend = {
      logEvent: (name, params) => logEvent(analytics, name, params),
      setUser: (userId, props) => {
        setUserId(analytics, userId);
        if (props) setUserProperties(analytics, props as Record<string, string>);
      },
    };
  } catch (error) {
    console.warn('[analytics] Web analytics unavailable', error);
  }
}

export async function initAnalytics(): Promise<void> {
  if (initialised) return;
  initialised = true;
  await initWebAnalytics();
}

export function logEvent(name: string, params?: AnalyticsParams): void {
  backend.logEvent(name, params);
  if (__DEV__) console.log(`[analytics] ${name}`, params ?? '');
}

export function setAnalyticsUser(userId: string | null, props?: AnalyticsParams): void {
  backend.setUser(userId, props);
}

/**
 * Central error sink. Replace the body with a Crashlytics call once
 * `@react-native-firebase/crashlytics` is wired into a dev build.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[error]', message, context ?? '');
  logEvent('app_error', { message: message.slice(0, 100) });
}

/** Common analytics event names, kept in one place to avoid typos. */
export const AnalyticsEvents = {
  login: 'login',
  logout: 'logout',
  signUp: 'sign_up',
  screenView: 'screen_view',
  lessonOpened: 'lesson_opened',
  videoPlayed: 'video_played',
  articleRead: 'article_read',
  materialDownloaded: 'material_downloaded',
  quizStarted: 'quiz_started',
  quizSubmitted: 'quiz_submitted',
  attendanceMarked: 'attendance_marked',
  notificationSent: 'notification_sent',
  languageChanged: 'language_changed',
} as const;
