import React, { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { announcementsFor } from '@/services/notificationService';
import type { Announcement } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';

/**
 * A notice, over the screen, that has to be read before it is dismissed.
 *
 * For the announcement an admin needs everybody to actually see — payment
 * details, a class cancelled an hour before it starts — rather than the
 * ordinary sort that belongs in a list. Which is which is the admin's decision,
 * made per announcement, and off unless they choose it: a popup is the loudest
 * thing this app can do to somebody and it stops working the moment it becomes
 * routine.
 *
 * SHOWN ONCE, PER PERSON, PER NOTICE. Closing it is final. It does not return
 * tomorrow, it does not return on the next device — the record is kept per
 * device, so a second phone shows it once too, which is the honest reading of
 * "has this person seen it here".
 *
 * The full text scrolls inside the card rather than being truncated. A notice
 * carrying a bank account number is worthless with the last line cut off.
 */
const SEEN_KEY = '@weeklyclass/notices-seen';

export function NoticePopup() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [seen, setSeen] = useState<string[] | null>(null);

  const { data } = useAsync(
    () => (user ? announcementsFor(user, 20) : Promise.resolve([] as Announcement[])),
    [user?.uid]
  );

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((raw) => {
        if (!live) return;
        try {
          const parsed = raw ? JSON.parse(raw) : [];
          setSeen(Array.isArray(parsed) ? parsed : []);
        } catch {
          setSeen([]);
        }
      })
      .catch(() => live && setSeen([]));
    return () => {
      live = false;
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setSeen((current) => {
      const next = [...(current ?? []), id];
      // Best effort. A notice shown twice because storage failed is a small
      // annoyance; a crash on a dashboard is not.
      void AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  // Nothing until the seen list has been read, or a notice somebody closed
  // last week would flash up again on every single load.
  if (seen === null || !user) return null;

  const pending = (data ?? []).filter((item) => item.popup && !seen.includes(item.id));
  const notice = pending[0];
  if (!notice) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => dismiss(notice.id)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.headText}>{t('announcement.notice')}</Text>
            <Pressable
              onPress={() => dismiss(notice.id)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.closeText}>{t('common.close')}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {notice.image ? (
              <Image source={{ uri: notice.image }} style={styles.image} resizeMode="contain" />
            ) : null}

            <Text style={styles.title}>{notice.title}</Text>

            {/* Selectable, because the whole point of a notice like this is
                often a number somebody has to copy. */}
            <Text style={styles.message} selectable>
              {notice.message}
            </Text>
          </ScrollView>

          <Pressable
            onPress={() => dismiss(notice.id)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={({ pressed }) => [styles.done, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Ionicons name="checkmark" size={17} color={colors.textOnAccent} />
            <Text style={styles.doneText}>{t('announcement.understood')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,30,74,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    // Never taller than the screen it sits on, so the close button and the
    // acknowledge button are always reachable however long the notice runs.
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: brand.slate,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  close: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  closeText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.danger },

  body: { padding: spacing.lg, gap: spacing.md },
  image: { width: '100%', height: 160, borderRadius: radius.md },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: brand.navyDeep,
    lineHeight: 24,
  },
  message: { fontSize: fontSize.sm, color: colors.text, lineHeight: 21 },

  done: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    marginTop: 0,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: brand.orange,
  },
  doneText: { color: colors.textOnAccent, fontSize: fontSize.md, fontWeight: fontWeight.bold },
});
