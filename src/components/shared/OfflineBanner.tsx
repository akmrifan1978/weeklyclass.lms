import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';

/**
 * A thin strip that appears when the connection goes.
 *
 * It says the app still works rather than just announcing the problem. Most of
 * what someone opens — lessons they have already read, the Qur'an, prayer times,
 * their reading plan — is cached and genuinely available; the message people
 * need is "carry on, some things will be out of date", not "something is wrong".
 *
 * Rendered above the navigator rather than per screen, so it cannot be missed on
 * one screen and shown on another.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { online } = useNetworkStatus();
  const insets = useSafeAreaInsets();

  /**
   * Coming back deserves a word too, briefly.
   *
   * Anything written while offline is queued by Firestore and sent the moment
   * the connection returns — but that happens invisibly, and somebody who
   * submitted an assignment on a bus with no signal has no way of knowing it
   * ever left the phone. The strip turns green, says so, and gets out of the
   * way; a permanent "you are online" badge is noise, since online is the
   * state people already assume they are in.
   */
  const [justReturned, setJustReturned] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setJustReturned(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setJustReturned(true);
    const timer = setTimeout(() => setJustReturned(false), 4000);
    return () => clearTimeout(timer);
  }, [online]);

  if (online && !justReturned) return null;

  return (
    <View
      style={[
        styles.banner,
        online ? styles.bannerOnline : null,
        { paddingTop: insets.top + spacing.xs },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons
        name={online ? 'cloud-done' : 'cloud-offline'}
        size={15}
        color={colors.textInverse}
      />
      <Text style={styles.text}>{t(online ? 'offline.restored' : 'offline.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  bannerOnline: { backgroundColor: colors.success },
  text: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
