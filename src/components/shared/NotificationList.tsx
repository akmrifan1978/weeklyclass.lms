import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { relativeTime } from '@/utils/date';
import { inboxFor, markAllRead, markRead } from '@/services/notificationService';
import type { AppNotification, NotificationCategory } from '@/types';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Card,
  Screen,
  SkeletonList,
} from '@/components/ui';

const CATEGORY_ICON: Record<NotificationCategory, keyof typeof Ionicons.glyphMap> = {
  general: 'notifications-outline',
  class_reminder: 'time-outline',
  new_lesson: 'book-outline',
  new_video: 'videocam-outline',
  quiz_available: 'help-circle-outline',
  quiz_closing: 'alarm-outline',
  new_article: 'newspaper-outline',
  event_reminder: 'calendar-outline',
  attendance_reminder: 'checkbox-outline',
  announcement: 'megaphone-outline',
};

/**
 * The notification inbox, shared by students and teachers. The audience each
 * user belongs to is resolved in `notificationService.inboxFor`.
 */
export function NotificationList() {
  const { t } = useTranslation();
  const { user, enablePush } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();
  const router = useRouter();
  const [enablingPush, setEnablingPush] = useState(false);

  const load = useCallback(async () => {
    if (!user) return [] as AppNotification[];
    return inboxFor(user, 40);
  }, [user]);

  const { data, loading, refreshing, error, refresh, reload, setData } = useAsync(load, [user?.uid]);

  const items = data ?? [];
  const unread = items.filter((item) => !(item.readBy ?? []).includes(user?.uid ?? ''));

  const handleOpen = async (item: AppNotification) => {
    if (user && !(item.readBy ?? []).includes(user.uid)) {
      await markRead(item.id, user.uid);
      setData(
        items.map((row) =>
          row.id === item.id ? { ...row, readBy: [...(row.readBy ?? []), user.uid] } : row
        )
      );
    }
    if (item.route) router.push(item.route as never);
  };

  const handleMarkAll = async () => {
    if (!user) return;
    await markAllRead(items, user.uid);
    setData(items.map((row) => ({ ...row, readBy: [...(row.readBy ?? []), user.uid] })));
    toast.success(t('common.success'));
  };

  const handleEnablePush = async () => {
    setEnablingPush(true);
    try {
      const registration = await enablePush();
      if (registration.granted) toast.success(t('notification.pushEnabled'));
      else if (registration.reason === 'denied') toast.error(t('notification.pushDenied'));
      else toast.show(t('notification.scheduledNote'));
    } finally {
      setEnablingPush(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={t('notification.title')}
        subtitle={unread.length ? `${unread.length} ${t('notification.newBadge')}` : undefined}
        right={
          unread.length ? (
            <Pressable
              onPress={handleMarkAll}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('notification.markAllRead')}
            >
              <Ionicons name="checkmark-done" size={22} color={colors.textInverse} />
            </Pressable>
          ) : undefined
        }
      />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Button
          label={t('notification.enablePush')}
          icon="notifications-outline"
          variant="outline"
          size="sm"
          loading={enablingPush}
          onPress={handleEnablePush}
          style={{ marginBottom: spacing.lg }}
        />

        <AsyncBoundary
          loading={loading}
          error={error}
          empty={items.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{
            icon: 'notifications-off-outline',
            title: t('notification.noNotifications'),
          }}
        >
          <View style={{ gap: spacing.md }}>
            {items.map((item) => {
              const isUnread = !(item.readBy ?? []).includes(user?.uid ?? '');
              return (
                <Card
                  key={item.id}
                  onPress={() => handleOpen(item)}
                  accessibilityLabel={item.title}
                  style={isUnread ? styles.unreadCard : undefined}
                >
                  <View style={styles.row}>
                    <View style={[styles.icon, isUnread ? styles.iconUnread : null]}>
                      <Ionicons
                        name={CATEGORY_ICON[item.category] ?? 'notifications-outline'}
                        size={19}
                        color={isUnread ? colors.accent : colors.slate}
                      />
                    </View>
                    <View style={styles.body}>
                      <View style={styles.titleRow}>
                        <Text
                          style={[styles.title, isUnread ? styles.titleUnread : null]}
                          numberOfLines={2}
                        >
                          {item.title}
                        </Text>
                        {isUnread ? <View style={styles.dot} /> : null}
                      </View>
                      <Text style={styles.message} numberOfLines={3}>
                        {item.message}
                      </Text>
                      <Text style={styles.time}>
                        {relativeTime(item.sentAt ?? item.scheduledAt ?? item.createdAt, language)}
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  unreadCard: { borderColor: colors.accent, borderWidth: 1.5 },
  row: { flexDirection: 'row', gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconUnread: { backgroundColor: colors.accentSoft },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  titleUnread: { fontWeight: fontWeight.bold },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: brand.red },
  message: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  time: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
});
