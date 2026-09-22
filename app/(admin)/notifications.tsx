import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useResponsive } from '@/hooks/useResponsive';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { NotificationComposer } from '@/features/notifications/NotificationComposer';
import { NotificationInbox } from '@/components/shared/NotificationList';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { Screen } from '@/components/ui';

type Tab = 'inbox' | 'sent';

/**
 * Notifications for an admin: the ones sent TO them, and the ones they send.
 *
 * The bell in the admin bar counted the admin's own unread notifications but
 * opened this page, which only listed what had been sent to everybody else —
 * so the count could never be cleared and nothing in it could be read. "For
 * me" is the admin's own inbox; the bell opens it.
 *
 * Two plain buttons rather than the shared chip row: that row scrolls
 * sideways, and a scrolling row above a full-height screen has no height of
 * its own to hug, so it stretched down the page.
 */
export default function AdminNotifications() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { unread } = useNotifications();
  const { gutter } = useResponsive();
  const params = useLocalSearchParams<{ tab?: string; open?: string }>();
  const canSend = can('SEND_NOTIFICATIONS');

  const [tab, setTab] = useState<Tab>(
    params.tab === 'inbox' || params.open || !canSend ? 'inbox' : 'sent'
  );
  useEffect(() => {
    if (params.tab === 'inbox' || params.open) setTab('inbox');
  }, [params.tab, params.open]);

  const tabs: { value: Tab; label: string }[] = [
    {
      value: 'inbox',
      label: unread ? `${t('notification.inbox')} (${unread})` : t('notification.inbox'),
    },
    { value: 'sent', label: t('notification.sentTab') },
  ];

  return (
    <View style={styles.fill}>
      {canSend ? (
        <View style={[styles.tabs, { paddingHorizontal: gutter }]}>
          {tabs.map((option) => {
            const on = option.value === tab;
            return (
              <Pressable
                key={option.value}
                onPress={() => setTab(option.value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && styles.pressed]}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {tab === 'inbox' || !canSend ? (
        <Screen edges={['bottom']}>
          <NotificationInbox />
        </Screen>
      ) : (
        <PermissionGuard permission="SEND_NOTIFICATIONS">
          <NotificationComposer />
        </PermissionGuard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  tab: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.transparent,
  },
  tabOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pressed: { opacity: 0.8 },
  tabText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  tabTextOn: { color: colors.accentDark, fontWeight: fontWeight.semibold },
});
