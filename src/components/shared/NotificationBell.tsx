import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { brand, colors, fontWeight, radius } from '@/constants/theme';

/**
 * Unread messages, in the corner of the app bar.
 *
 * The count already existed on the Notifications tab, which is only any use to
 * somebody already looking at the tab bar — and on the admin shell, where there
 * is no tab bar at all, nothing said a message had arrived until you went
 * looking for it.
 *
 * It reads the app's one live notification subscription rather than counting
 * anything itself, so it costs nothing and changes at the moment the data does:
 * it appears when a message arrives, and goes when the message is read or an
 * admin deletes it.
 */

/** Past this it stops being a count and starts being "a lot". */
const MAX_SHOWN = 99;

export function NotificationBell({
  tint = colors.textInverse,
  size = 22,
}: {
  /** Matches whatever bar it is sitting in. */
  tint?: string;
  size?: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { unread } = useNotifications();
  const { user } = useAuth();

  const label =
    unread > 0
      ? `${t('notification.title')}, ${t('notification.newBadge')}: ${unread}`
      : t('notification.title');

  return (
    <Pressable
      // An admin's inbox is the "For me" tab of their notifications page.
      onPress={() =>
        user?.role === 'admin'
          ? router.push({ pathname: '/(admin)/notifications', params: { tab: 'inbox' } })
          : router.push('/notifications' as never)
      }
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons
        name={unread > 0 ? 'notifications' : 'notifications-outline'}
        size={size}
        color={tint}
      />

      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {unread > MAX_SHOWN ? `${MAX_SHOWN}+` : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 2 },
  // Sits on the corner of the bell rather than beside it, so a growing count
  // never pushes the icons next to it out of place.
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: brand.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    // A literal, not a scale token: the smallest named size is meant for body
    // text and is still too large to fit two digits in an 18px circle.
    fontSize: 10,
    lineHeight: 14,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
  },
});
