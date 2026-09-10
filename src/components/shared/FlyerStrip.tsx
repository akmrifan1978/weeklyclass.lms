import React, { useCallback } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLive } from '@/hooks/useLive';
import { watchShowing } from '@/services/flyerService';
import type { Flyer } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';

/**
 * The flyers currently on show, wherever they are shown.
 *
 * DRAWS NOTHING when there are none, and that is the important behaviour. A
 * dashboard with an empty advertising slot on it — a grey box, a heading with
 * nothing under it — looks broken, and most centres will run no flyers most of
 * the time. Nothing here reserves space it is not using.
 *
 * Live, so switching a poster on during an event puts it on people's screens
 * without them reopening anything.
 *
 * ONE ACROSS A PHONE, more as the window widens, and it scrolls sideways when
 * there are several. Stacking posters down a dashboard pushes everything a
 * student actually came for below the fold, which is how advertising earns
 * itself a reputation.
 */
export function FlyerStrip({
  position,
  limit = 6,
}: {
  position: 'home' | 'dashboard';
  limit?: number;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();

  const subscribe = useCallback(
    (onNext: (items: Flyer[]) => void, onError: (error: unknown) => void) =>
      watchShowing(position, onNext, onError, limit),
    [position, limit]
  );

  const { data } = useLive(subscribe, [position, limit]);
  const flyers = data ?? [];

  if (flyers.length === 0) return null;

  // A card wide enough to read a poster on, narrow enough that a second one
  // peeks in and says there is more to swipe. Capped so a desktop does not
  // stretch a single flyer across a whole monitor.
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
}: {
  flyer: Flyer;
  width?: number;
  openLabel: string;
}) {
  // The link when the admin gave one, the file itself when they did not. A
  // poster with nothing behind it is still worth being able to open full size.
  const target = flyer.link?.trim() || flyer.fileUrl;
  const open = () => Linking.openURL(target).catch(() => undefined);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={flyer.title}
      style={({ pressed }) => [styles.card, width ? { width } : styles.cardFull, { opacity: pressed ? 0.9 : 1 }]}
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

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {flyer.title}
        </Text>
        {flyer.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {flyer.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
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
  // 16:9-ish. Most posters are portrait and most screens are not, so the image
  // is cropped to a consistent band rather than letting each flyer decide how
  // much of the page it takes.
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
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: brand.navyDeep },
  description: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
});
