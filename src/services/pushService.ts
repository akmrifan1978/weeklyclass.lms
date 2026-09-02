import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { doc, updateDoc } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { colors } from '@/constants/theme';

/**
 * Push delivery.
 *
 * WHAT IS FREE AND WORKING NOW
 * - Native (Android/iOS): Expo Push Service. Tokens are collected here and sent
 *   through `https://exp.host/--/api/v2/push/send`, which needs no secret key,
 *   so an admin can trigger a real device notification without any server.
 * - Local scheduled notifications on the device (class reminders, quiz closing)
 *   via `expo-notifications` — these fire even with the app closed.
 *
 * WHAT NEEDS A PAID PLAN
 * - Web push through FCM requires a server key to send, which must never sit in
 *   client code. Web users therefore receive in-app notifications only.
 * - Server-side *scheduled* fan-out (send at 8pm to 3,000 people whether or not
 *   an admin has the app open) needs Cloud Functions / Cloud Scheduler, i.e.
 *   the Blaze plan. `notificationService` stores every scheduled notification
 *   so that job can be switched on later without changing any screen.
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface PushRegistration {
  token: string | null;
  granted: boolean;
  /** Why registration did not produce a token, for the settings screen. */
  reason?: 'denied' | 'simulator' | 'unsupported' | 'error';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'WeeklyClass LMS',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.accent,
  });
}

/** Requests permission and returns an Expo push token. */
export async function registerForPush(): Promise<PushRegistration> {
  if (Platform.OS === 'web') {
    // FCM web tokens can be obtained, but nothing can send to them without a
    // server key, so we do not ask the user for a permission we cannot honour.
    return { token: null, granted: false, reason: 'unsupported' };
  }

  if (!Device.isDevice) {
    return { token: null, granted: false, reason: 'simulator' };
  }

  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return { token: null, granted: false, reason: 'denied' };

    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
      Constants.expoConfig?.extra?.eas?.projectId ??
      undefined;

    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return { token: token.data, granted: true };
  } catch (error) {
    console.warn('[push] registration failed', error);
    return { token: null, granted: false, reason: 'error' };
  }
}

/** Stores the token under a stable per-device key so re-installs replace it. */
export async function saveToken(uid: string, token: string): Promise<void> {
  const deviceKey = `${Platform.OS}_${Device.modelName ?? 'device'}`.replace(/[^\w]/g, '_');
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    [`pushTokens.${deviceKey}`]: token,
  });
}

export interface PushMessage {
  to: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSendReport {
  attempted: number;
  accepted: number;
  failed: number;
  error?: string;
}

/**
 * Sends through the Expo Push Service in chunks of 100 (its documented limit).
 * Returns a report rather than throwing — a failed push must not roll back the
 * notification record the user can still see in the app.
 */
export async function sendExpoPush(message: PushMessage): Promise<PushSendReport> {
  const tokens = message.to.filter((t) => t?.startsWith('ExponentPushToken'));
  if (tokens.length === 0) return { attempted: 0, accepted: 0, failed: 0 };

  let accepted = 0;
  let failed = 0;
  let error: string | undefined;

  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          chunk.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: 'default',
            channelId: 'default',
          }))
        ),
      });

      const payload = (await response.json()) as {
        data?: { status: string; message?: string }[];
        errors?: { message: string }[];
      };

      if (payload.errors?.length) {
        error = payload.errors[0]?.message;
        failed += chunk.length;
        continue;
      }
      for (const ticket of payload.data ?? []) {
        if (ticket.status === 'ok') accepted += 1;
        else {
          failed += 1;
          error ??= ticket.message;
        }
      }
    } catch (err) {
      failed += chunk.length;
      error ??= err instanceof Error ? err.message : String(err);
    }
  }

  return { attempted: tokens.length, accepted, failed, error };
}

/**
 * Schedules a notification on this device.
 * Used for reminders the app already knows about — "class starts in 1 hour",
 * "quiz closes in 15 minutes" — with no server involved.
 */
export async function scheduleLocal(params: {
  title: string;
  body: string;
  at: Date;
  data?: Record<string, unknown>;
}): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const seconds = Math.floor((params.at.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return null;

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: params.data ?? {},
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
  } catch (error) {
    console.warn('[push] could not schedule local notification', error);
    return null;
  }
}

export async function cancelLocal(identifier: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
}

export async function cancelAllLocal(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
}

/**
 * Reminder ladder for an upcoming class: one hour and fifteen minutes before.
 * Called when the student opens the app, and it clears previous schedules so
 * repeated openings do not stack duplicates.
 */
export async function scheduleEventReminders(events: {
  id: string;
  title: string;
  venue?: string;
  startsAt: Date;
}[]): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelAllLocal();

  for (const event of events.slice(0, 10)) {
    const oneHour = new Date(event.startsAt.getTime() - 60 * 60 * 1000);
    const fifteen = new Date(event.startsAt.getTime() - 15 * 60 * 1000);

    await scheduleLocal({
      title: event.title,
      body: `Starts in 1 hour${event.venue ? ` · ${event.venue}` : ''}`,
      at: oneHour,
      data: { route: `/student/calendar`, eventId: event.id },
    });
    await scheduleLocal({
      title: event.title,
      body: 'Starts in 15 minutes',
      at: fifteen,
      data: { route: `/student/calendar`, eventId: event.id },
    });
  }
}

export function addNotificationResponseListener(
  handler: (data: Record<string, unknown>) => void
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handler((response.notification.request.content.data ?? {}) as Record<string, unknown>);
  });
  return () => subscription.remove();
}
