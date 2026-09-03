import React from 'react';
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

  if (online) return null;

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline" size={15} color={colors.textInverse} />
      <Text style={styles.text}>{t('offline.banner')}</Text>
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
  text: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
