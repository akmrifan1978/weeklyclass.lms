import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLive } from '@/hooks/useLive';
import { isShowing, watchShowing } from '@/services/flyerService';
import type { Flyer } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';

/**
 * The flyers currently on show, at the top of the screen.
 *
 * DRAWS NOTHING when there are none, and that is the important behaviour. An
 * empty advertising slot — a grey box, a heading with nothing under it — looks
 * broken, and most centres will run no flyers most of the time. Nothing here
 * reserves space it is not using.
 */

/** Which flyers this person has closed, per device. */
const DISMISSED_KEY = '@weeklyclass/flyers-dismissed';

export function FlyerStrip({
  position,
  limit = 6,
}: {
  position: 'home' | 'dashboard';
  limit?: number;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  /**
   * A clock, because the end of a flyer's run is not a data change.
   *
   * The listener below delivers changes to DOCUMENTS, and nothing in Firestore
   * changes at the moment a flyer expires — its end time simply passes. Without
   * this the poster would sit there until something unrelated caused a redraw,
   * which on a dashboard somebody leaves open is a long time.
   *
   * Every thirty seconds is enough to honour a time set to the minute, and is
   * nothing next to what the screen is already doing.
   */
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
      watchShowing(position, onNext, onError, limit),
    [position, limit]
  );

  const { data } = useLive(subscribe, [position, limit]);

  const dismiss = useCallback(
    (id: string) => {
      setDismissed((current) => {
        const next = [...(current ?? []), id];
        // Best effort. A closed flyer that comes back after a reinstall is a
        // small annoyance; a crash because storage was unavailable is not.
        void AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    },
    []
  );

  // Nothing is drawn until the dismissal list has been read. Showing a flyer
  // and then snatching it away a frame later is worse than showing it a beat
  // late.
  if (dismissed === null) return null;

  const flyers = (data ?? []).filter((f) => isShowing(f, now) && !dismissed.includes(f.id));
  if (flyers.length === 0) return null;

  // Wide enough to read a poster on, narrow enough that a second one peeks in
  // and says there is more to swipe. Capped so a desktop does not stretch a
  // single flyer across a whole monitor.
  const cardWidth = Math.min(340, Math.max(240, width - spacing.xl * 2 - 40));
  const single = flyers.length === 1;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal={!single}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={single ? undefined : styles.strip}
      >
        {flyers.map((flyer) => (
          <FlyerCard
            key={flyer.id}
            flyer={flyer}
            width={single ? undefined : cardWidth}
            openLabel={t('flyer.open')}
            closeLabel={t('common.close')}
            onClose={() => dismiss(flyer.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function FlyerCard({
  flyer,
  width,
  openLabel,
  closeLabel,
  onClose,
}: {
  flyer: Flyer;
  width?: number;
  openLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  // The link when the admin gave one, the file itself when they did not. A
  // poster with nothing behind it is still worth being able to open full size.
  const target = flyer.link?.trim() || flyer.fileUrl;
  const open = () => Linking.openURL(target).catch(() => undefined);

  return (
    <View style={[styles.card, width ? { width } : styles.cardFull]}>
      {/* Read aloud as what it says, never as its title. The title is an
          admin's filing name — often just the uploaded file's name — and a
          screen reader announcing "595d9717-d4f9…" is the same leak as
          printing it. */}
      <Pressable
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={flyer.description?.trim() || openLabel}
      >
        {flyer.fileType === 'pdf' ? (
          // A PDF cannot be shown in place, so it is offered rather than
          // pretended at. A broken image frame would be worse than an honest
          // document card.
          <View style={styles.pdf}>
            <Ionicons name="document-text" size={30} color={brand.orange} />
            <Text style={styles.pdfText}>{openLabel}</Text>
          </View>
        ) : (
          <Image source={{ uri: flyer.fileUrl }} style={styles.image} resizeMode="cover" />
        )}

        {/*
         * The title is NOT shown to the people looking at the flyer.
         *
         * It is the admin's name for it — how they find it again in the flyer
         * list — and in practice it is often the name of the uploaded file,
         * which put strings like "595d9717-d4f9-4c86…" under a poster on every
         * dashboard. The artwork already says what it is advertising. The title
         * stays on the record and in the admin screen, where it is useful.
         */}
        {flyer.description ? (
          <View style={styles.body}>
            <Text style={styles.description} numberOfLines={2}>
              {flyer.description}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {/* Its own control, outside the pressable area, or closing it would open
          the link on the way past. Over the image rather than beside the title,
          so it is in the same place on every card whatever the artwork. */}
      <Pressable
        onPress={onClose}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="close" size={16} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  strip: { gap: spacing.md, paddingRight: spacing.lg, paddingVertical: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardFull: { width: '100%' },
  // A consistent band. Most posters are portrait and most screens are not, so
  // the image is cropped to one height rather than letting each flyer decide
  // how much of the page it takes.
  image: { width: '100%', height: 160, backgroundColor: colors.surfaceMuted },
  pdf: {
    width: '100%',
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  pdfText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: brand.orangeDark },
  body: { padding: spacing.md, gap: 3 },
  description: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  close: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    // Dark enough to sit on any artwork. A pale close button vanishes against
    // a pale poster, which is the one place it must not.
    backgroundColor: 'rgba(4,30,74,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
