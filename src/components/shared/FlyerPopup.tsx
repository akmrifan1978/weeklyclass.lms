import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLive } from '@/hooks/useLive';
import { flyerKey, isShowing, watchShowing } from '@/services/flyerService';
import type { Flyer } from '@/types';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';

/**
 * The flyer, over the screen, the way a poster is meant to be seen.
 *
 * WHY, when a strip already exists. The strip sits at the top of the dashboard
 * and is easy to scroll past — which is fine for a notice and no use at all for
 * something the centre has paid attention to. Asked for as "displayed like
 * this", with a picture of a full-screen advert and a close button, and the
 * complaint attached was that nobody was seeing it.
 *
 * WHAT KEEPS IT FROM BECOMING A NUISANCE, because an advert that cannot be
 * escaped is worse than one nobody sees:
 *
 *   - It appears once per flyer per device. Closing it is remembered, and the
 *     SAME remembered list the strip uses, so closing it in either place closes
 *     it in both.
 *   - Editing a flyer makes it new again: the key carries the flyer's updated
 *     time, so a changed poster is shown once more and an unchanged one stays
 *     closed.
 *   - Only the first flyer is popped up, however many are running. The rest
 *     stay in the strip, where somebody can look through them at their leisure.
 *   - It never covers anything on a first paint: it waits for the stored list
 *     to be read, so nobody is shown a poster that is then snatched away.
 *
 * The strip stays exactly as it was. This is the announcement; that is the
 * record.
 */

const DISMISSED_KEY = '@weeklyclass/flyers-dismissed';

export function FlyerPopup({ position }: { position: 'home' | 'dashboard' }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((raw) => {
        if (!live) return;
        try {
          const parsed = raw ? JSON.parse(raw) : [];
          setDismissed(Array.isArray(parsed) ? parsed : []);
        } catch {
          setDismissed([]);
        }
      })
      .catch(() => live && setDismissed([]));
    return () => {
      live = false;
    };
  }, []);

  const subscribe = useCallback(
    (onNext: (items: Flyer[]) => void, onError: (error: unknown) => void) =>
      watchShowing(position, onNext, onError, 6),
    [position]
  );
  const { data } = useLive(subscribe, [position]);

  const close = useCallback((flyer: Flyer) => {
    setDismissed((current) => {
      // The key alone. Storing the bare id as well was the bug that hid this
      // from the very people it was shown to: a flyer closed in the strip once,
      // months ago, silenced every later version of itself.
      const next = [...(current ?? []), flyerKey(flyer)];
      void AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  if (dismissed === null) return null;

  const flyer = (data ?? []).find(
    (f) => isShowing(f, now) && !dismissed.includes(flyerKey(f))
  );
  if (!flyer || flyer.fileType !== 'image') return null;

  // Tall enough to read a poster, short enough to leave the close button and
  // the page edges visible on a phone held in one hand.
  const maxWidth = Math.min(380, width - spacing.xl * 2);
  const maxHeight = height * 0.72;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close(flyer)}>
      {/* The backdrop closes it too: on a phone the corner button is a small
          target, and an advert nobody can dismiss is the thing to avoid. */}
      <Pressable style={styles.backdrop} onPress={() => close(flyer)} accessibilityRole="button">
        <Pressable style={[styles.card, { maxWidth }]} onPress={() => undefined}>
          <Pressable
            onPress={() => close(flyer)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={styles.close}
            hitSlop={12}
          >
            <Ionicons name="close" size={18} color={colors.textInverse} />
          </Pressable>

          <Pressable
            disabled={!flyer.link}
            onPress={() => {
              if (flyer.link) void Linking.openURL(flyer.link).catch(() => undefined);
              close(flyer);
            }}
          >
            <Image
              source={{ uri: flyer.fileUrl }}
              style={[styles.image, { maxWidth, height: maxHeight }]}
              resizeMode="contain"
              accessibilityLabel={flyer.title}
            />
          </Pressable>

          {flyer.link ? (
            <Pressable
              onPress={() => {
                void Linking.openURL(flyer.link!).catch(() => undefined);
                close(flyer);
              }}
              style={styles.action}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{t('flyer.open')}</Text>
              <Ionicons name="arrow-forward" size={15} color={colors.textInverse} />
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,30,74,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadow.lg,
  },
  image: { width: '100%', backgroundColor: colors.surface },
  close: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,30,74,0.65)',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
  },
  actionText: { color: colors.textInverse, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
