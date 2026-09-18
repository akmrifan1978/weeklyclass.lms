import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { relativeTime } from '@/utils/date';
import { routeForRole } from '@/services/notificationRoutes';
import { viewersOf, type Viewers } from '@/services/notificationViewers';
import type { AppNotification } from '@/types';
import { FormSheet } from '@/components/ui';

/**
 * One notification, opened.
 *
 * The list shows a title cut to two lines and a message cut to three, and a
 * notification with no page behind it — a reminder, a notice from the admin —
 * used to do nothing at all when tapped. Now tapping always opens it here, in
 * full, with an Open button when there is a page for this reader to go to.
 *
 * `showViewers` adds who has seen it, for the admin looking at what they sent.
 */
export function NotificationDetail({
  notification,
  onClose,
  showViewers = false,
}: {
  notification: AppNotification | null;
  onClose: () => void;
  showViewers?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();

  const destination = routeForRole(notification?.route, user?.role);

  return (
    <FormSheet
      visible={Boolean(notification)}
      title={t('notification.one')}
      onClose={onClose}
      onSubmit={
        destination
          ? () => {
              onClose();
              router.push(destination as never);
            }
          : undefined
      }
      submitLabel={t('notification.open')}
    >
      {notification ? (
        <View style={styles.body}>
          <Text style={styles.title} selectable>
            {notification.title}
          </Text>
          <Text style={styles.time}>
            {relativeTime(
              notification.sentAt ?? notification.scheduledAt ?? notification.createdAt,
              language
            )}
          </Text>
          {notification.image ? (
            <Image source={{ uri: notification.image }} style={styles.image} resizeMode="contain" />
          ) : null}
          <Text style={styles.message} selectable>
            {notification.message}
          </Text>
          {showViewers ? <SeenBy notification={notification} /> : null}
        </View>
      ) : null}
    </FormSheet>
  );
}

/** "Seen by 12 of 30", and the names. */
function SeenBy({ notification }: { notification: AppNotification }) {
  const { t } = useTranslation();
  const [viewers, setViewers] = useState<Viewers | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setViewers(null);
    setFailed(false);
    viewersOf(notification)
      .then((result) => live && setViewers(result))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // The notification's id is what identifies it; its object changes on every
    // update of the list without anything about it having changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification.id]);

  const count = viewers?.count ?? (notification.readBy ?? []).length;

  return (
    <View style={styles.viewers}>
      <View style={styles.viewersHeader}>
        <Ionicons name="eye-outline" size={16} color={colors.primary} />
        <Text style={styles.viewersTitle}>
          {viewers?.audience != null
            ? t('notification.seenByOf', { count, total: viewers.audience })
            : t('notification.seenBy', { count })}
        </Text>
      </View>
      {!viewers && !failed ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}
      {viewers && viewers.names.length === 0 ? (
        <Text style={styles.none}>{t('notification.noViewers')}</Text>
      ) : null}
      {viewers?.names.map((name, index) => (
        <Text key={`${name}-${index}`} style={styles.viewer}>
          • {name}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, lineHeight: 24 },
  time: { fontSize: fontSize.xs, color: colors.textMuted },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  message: { fontSize: fontSize.md, color: colors.text, lineHeight: 23, marginTop: spacing.xs },
  viewers: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.xs,
  },
  viewersHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  viewersTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  spinner: { alignSelf: 'flex-start', marginTop: spacing.xs },
  none: { fontSize: fontSize.sm, color: colors.textMuted },
  viewer: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
});
