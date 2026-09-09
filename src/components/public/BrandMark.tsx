import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { APP_NAME } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import type { AppSettings } from '@/types';

/**
 * The logo lockup: a mark, the name in two tones, and a line under it.
 *
 * One component rather than three copies, because it appears in the bar, in
 * the open menu and on the front page, and a wordmark that is subtly different
 * in each of those is a wordmark nobody recognises.
 */

/**
 * Where the name breaks into its two colours.
 *
 * The reference sets the name in navy with a coloured tail — "WEEKLYCLASS" and
 * then ".ORG" in orange. The tail is not a fixed string here, because the name
 * is an admin setting and may be anything: this finds whatever reads as a
 * suffix and colours that.
 *
 * A domain ending wins, since a dot is the strongest signal of one. Failing
 * that the last word is used, which turns "WeeklyClass LMS" into WEEKLYCLASS +
 * LMS — the same two-tone shape the reference has. A single word with neither
 * simply has no tail, and is drawn in navy alone rather than being split at an
 * arbitrary letter.
 */
export function splitWordmark(name: string): { head: string; tail: string } {
  const value = name.trim();

  const domain = value.match(/^(.*?)(\.[A-Za-z]{2,})$/);
  if (domain) return { head: domain[1], tail: domain[2] };

  const lastSpace = value.lastIndexOf(' ');
  if (lastSpace > 0) {
    return { head: value.slice(0, lastSpace), tail: value.slice(lastSpace + 1) };
  }

  return { head: value, tail: '' };
}

export function BrandMark({
  settings,
  size = 'bar',
  showLine = true,
}: {
  settings?: AppSettings | null;
  /** `bar` in the header and the menu, `hero` on the front page. */
  size?: 'bar' | 'hero';
  showLine?: boolean;
}) {
  const { t } = useTranslation();
  const hero = size === 'hero';
  const name = settings?.appName?.trim() || APP_NAME;
  const { head, tail } = splitWordmark(name);

  const box = hero ? styles.markBoxHero : styles.markBox;
  const glyph = hero ? 30 : 20;

  return (
    <View style={styles.row}>
      <View style={box}>
        {settings?.logoUrl ? (
          <Image
            source={{ uri: settings.logoUrl }}
            style={hero ? styles.markImageHero : styles.markImage}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Ionicons name="book" size={glyph} color={colors.textInverse} />
        )}
      </View>

      <View style={styles.words}>
        {/*
          One Text with a nested Text rather than two side by side: the tail has
          to sit hard against the head with no word space, and it has to wrap
          with it rather than away from it on a narrow phone.
        */}
        <Text
          style={[styles.wordmark, hero && styles.wordmarkHero]}
          numberOfLines={1}
          accessibilityLabel={name}
        >
          {head.toUpperCase()}
          {tail ? <Text style={styles.wordmarkTail}>{tail.toUpperCase()}</Text> : null}
        </Text>

        {showLine ? (
          <Text style={styles.brandLine} numberOfLines={1}>
            {t('public.brandLine')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  markBox: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: brand.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  markBoxHero: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: brand.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Inset, so a square logo does not sit corner-to-corner in a rounded tile.
  markImage: { width: 30, height: 30 },
  markImageHero: { width: 44, height: 44 },

  words: { flex: 1 },
  wordmark: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.heavy,
    color: brand.navyDeep,
    letterSpacing: -0.2,
  },
  wordmarkHero: { fontSize: fontSize.xl },
  wordmarkTail: { color: brand.orange },

  brandLine: {
    fontSize: 8,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 1,
  },
});
