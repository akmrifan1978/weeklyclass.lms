import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radius, spacing } from '@/constants/theme';
import { useBranding } from '@/hooks/useBranding';
import { useResponsive } from '@/hooks/useResponsive';
import { VideoPlayer } from '@/components/shared/VideoPlayer';
import { IconButton } from '@/components/ui';

/**
 * The app banner: images and videos an admin chose, at the top of the home
 * screens.
 *
 * Draws nothing when no item has been chosen, so it costs no space until an
 * admin sets one up.
 *
 * ONE ITEM AT A TIME, swiped on a phone or tablet and stepped with arrows on a
 * desktop, where there is no swipe. Images move on by themselves; a video waits
 * for the person watching it, because advancing past a video somebody has just
 * started is the fastest way to make them stop trusting the banner.
 */
const ADVANCE_MS = 6000;

export function AppBanner() {
  const { t } = useTranslation();
  const { bannerItems: items } = useBranding();
  const { isPhone } = useResponsive();

  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const count = items.length;

  // The list can shrink while somebody is looking at its last item.
  useEffect(() => {
    if (count && index >= count) setIndex(0);
  }, [count, index]);

  const go = useCallback(
    (next: number) => {
      if (!count || !width) return;
      const target = (next + count) % count;
      scroller.current?.scrollTo({ x: target * width, animated: true });
      setIndex(target);
    },
    [count, width]
  );

  useEffect(() => {
    if (count < 2 || items[index]?.type === 'video') return undefined;
    const timer = setTimeout(() => go(index + 1), ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [count, index, items, go]);

  if (!count) return null;

  return (
    <View style={styles.wrap} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
          }
        >
          {items.map((item, i) => {
            const label = item.title?.trim() || t('banner.slide', { n: i + 1, total: count });
            return (
              <View key={item.id} style={{ width }} accessibilityLabel={label}>
                {item.type === 'video' ? (
                  <VideoPlayer url={item.url} title={label} />
                ) : (
                  <Image
                    source={{ uri: item.url }}
                    style={styles.image}
                    resizeMode="cover"
                    accessibilityLabel={label}
                  />
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {count > 1 ? (
        <View style={styles.controls}>
          {!isPhone ? (
            <IconButton
              icon="chevron-back"
              label={t('banner.previous')}
              size={32}
              color={colors.textSecondary}
              onPress={() => go(index - 1)}
            />
          ) : null}
          <View style={styles.dots}>
            {items.map((item, i) => (
              <Pressable
                key={item.id}
                onPress={() => go(i)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ selected: i === index }}
                accessibilityLabel={t('banner.slide', { n: i + 1, total: count })}
                style={[styles.dot, i === index && styles.dotActive]}
              />
            ))}
          </View>
          {!isPhone ? (
            <IconButton
              icon="chevron-forward"
              label={t('banner.next')}
              size={32}
              color={colors.textSecondary}
              onPress={() => go(index + 1)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg, borderRadius: radius.lg, overflow: 'hidden' },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.border },
  dotActive: { width: 20, backgroundColor: colors.primary },
});
