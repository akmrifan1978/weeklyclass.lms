import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as push from '@/services/webPushService';
import { Button, Card } from '@/components/ui';

/**
 * Turning on notifications that reach the phone when the app is shut.
 *
 * A button rather than a switch, and this matters: browsers only accept a
 * permission request that came from something the person did, and a request
 * fired on page load is refused outright — Safari discards it without even
 * asking. So it has to be pressed.
 *
 * The three states are kept apart because they need different sentences.
 * "Not asked yet" is an offer. "Granted" is a confirmation with a way out.
 * "Denied" cannot be undone from here at all — the browser will not ask twice
 * — so it says where the setting lives instead of showing a button that would
 * do nothing.
 */
export function PushToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const [state, setState] = useState<push.PushState>('unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const current = push.pushState();
    setState(current);
    setSubscribed(current === 'granted' ? await push.isSubscribed() : false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'unsupported') return null;

  const enable = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await push.enablePush(user);
      setState(result);
      if (result === 'granted') {
        setSubscribed(true);
        toast.success(t('push.enabled'));
      } else if (result === 'denied') {
        toast.error(t('push.deniedToast'));
      }
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await push.disablePush();
      setSubscribed(false);
      toast.success(t('push.disabled'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Ionicons
            name={subscribed ? 'notifications' : 'notifications-outline'}
            size={18}
            color={subscribed ? colors.success : colors.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('push.title')}</Text>
          <Text style={styles.body}>
            {state === 'denied'
              ? t('push.blocked')
              : subscribed
                ? t('push.on')
                : t('push.off')}
          </Text>
        </View>
      </View>

      {state === 'denied' ? null : subscribed ? (
        <Button
          label={t('push.turnOff')}
          variant="outline"
          size="sm"
          loading={busy}
          onPress={() => void disable()}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : (
        <Button
          label={t('push.turnOn')}
          icon="notifications-outline"
          size="sm"
          loading={busy}
          onPress={() => void enable()}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  body: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18, marginTop: 2 },
});
