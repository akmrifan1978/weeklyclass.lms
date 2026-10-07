import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { watchSettings } from '@/services/settingsService';
import * as push from '@/services/webPushService';
import { Button, Card } from '@/components/ui';

/**
 * "Turn on notifications", asked for by the administrator and answered here.
 *
 * WHY IT EXISTS, AND WHAT IT CANNOT DO. An admin cannot switch notifications on
 * for somebody else's phone: the permission belongs to the browser and is
 * granted by the person holding the device, once, in response to something they
 * pressed. No server can do it for them, and a product that claims otherwise is
 * lying. What an admin CAN do is ask everybody at once - and that ask has to
 * arrive somewhere people actually look, which is the home screen, not a
 * settings page they have never opened.
 *
 * So: the admin presses one button, and this card appears on every home screen
 * where notifications are off, with one button that turns them on. Pressed
 * again next month, it comes back for whoever still has not.
 *
 * WHEN IT STAYS AWAY. When notifications are already on; when the browser has
 * no support for them; when the person has refused permission at browser level,
 * where no button of ours can help and asking again is pestering; when no admin
 * has asked; and when this person has already dismissed THIS ask. Dismissal is
 * remembered per ask, on the device, so "not now" is respected without
 * silencing the next one.
 */

const DISMISSED_KEY = 'weeklyclass.notifyPrompt.dismissed';

function readDismissed(): string {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? '';
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return '';
  }
}

function writeDismissed(stamp: string): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, stamp);
  } catch {
    // Nothing to do: the card reappears next time, which is the safe failure.
  }
}

/** A timestamp of any shape, as a comparable string. */
function stampOf(value: unknown): string {
  if (!value) return '';
  const date =
    value instanceof Date
      ? value
      : typeof (value as { toDate?: () => Date }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : null;
  return date ? date.toISOString() : String(value);
}

export function NotificationNudge() {
  const { t } = useTranslation();
  const { user, isGuest } = useAuth();
  const toast = useToast();

  const [askedAt, setAskedAt] = useState('');
  const [dismissed, setDismissed] = useState(readDismissed);
  const [state, setState] = useState<push.PushState>('unsupported');
  const [busy, setBusy] = useState(false);

  // The settings document is already watched elsewhere in the app, so this
  // listener costs one document and is served from cache after the first read.
  useEffect(() => {
    if (!user || isGuest) return undefined;
    return watchSettings((settings) => setAskedAt(stampOf(settings.notifyPromptAt)));
  }, [user, isGuest]);

  useEffect(() => {
    setState(push.pushState());
  }, []);

  const turnOn = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await push.enablePush(user);
      setState(result);
      if (result === 'granted') toast.success(t('push.enabled'));
      // 'denied' needs no toast of ours: the browser has just told them.
      else if (result === 'default') toast.show(t('push.notGranted'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  }, [t, toast, user]);

  const hide =
    !user ||
    isGuest ||
    !askedAt ||
    askedAt === dismissed ||
    state === 'granted' ||
    state === 'denied' ||
    state === 'unsupported';

  if (hide) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('push.nudgeTitle')}</Text>
          <Text style={styles.message}>{t('push.nudgeMessage')}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          label={t('push.enable')}
          icon="notifications-outline"
          size="sm"
          loading={busy}
          onPress={turnOn}
        />
        <Button
          label={t('common.notNow')}
          size="sm"
          variant="ghost"
          onPress={() => {
            writeDismissed(askedAt);
            setDismissed(askedAt);
          }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoSoft,
  },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  message: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
