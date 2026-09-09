import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';

import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { tone } from './tone';

/**
 * The navy band at the top of every public page.
 *
 * It carries three things and no more: what kind of page this is, what it is
 * called, and one sentence saying why it is worth reading. Everything else on
 * the page is a card below it.
 *
 * The band is where the navy lives now. The page around it is light, which is
 * what lets the cards be plain white and the separation come from the ground
 * rather than from an outline on every panel.
 */

/**
 * The eight-pointed star, tiled.
 *
 * Two squares, one turned through forty-five degrees — the khatim, which is
 * the motif this pattern is built from everywhere it appears in the tradition.
 * Drawn as an SVG tile rather than shipped as an image so it stays crisp at
 * any size and costs nothing to download, and held at six percent white: it
 * should be felt rather than read, and a pattern you can actually see behind
 * a title competes with the title.
 */
function StarField() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="khatim" patternUnits="userSpaceOnUse" width="48" height="48">
          <Path
            d="M8 8 H40 V40 H8 Z"
            fill="none"
            stroke={colors.textInverse}
            strokeOpacity={0.06}
            strokeWidth={1}
          />
          <Path
            d="M24 4 L44 24 L24 44 L4 24 Z"
            fill="none"
            stroke={colors.textInverse}
            strokeOpacity={0.06}
            strokeWidth={1}
          />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#khatim)" />
    </Svg>
  );
}

export function PublicHero({
  badge,
  title,
  subtitle,
  logo,
}: {
  /** The small outlined pill above the title, e.g. "Islamic Curriculum". */
  badge: string;
  title: string;
  subtitle?: string;
  /**
   * The organisation's mark, above everything else.
   *
   * The front page only. Every other page has the mark in the bar a few
   * pixels higher, and showing it twice on one screen would say nothing the
   * first one did not.
   */
  logo?: { show: boolean; url?: string | null };
}) {
  return (
    <View style={styles.hero}>
      <StarField />

      {logo?.show ? (
        <View style={styles.logo}>
          {logo.url ? (
            <Image
              source={{ uri: logo.url }}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Ionicons name="book" size={36} color={brand.orange} />
          )}
        </View>
      ) : null}

      <View style={styles.badge}>
        <Text style={styles.badgeText} numberOfLines={1}>
          {badge}
        </Text>
      </View>

      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>

      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: tone.band,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    // Clips the tiled pattern to the rounded corners; without it the star
    // field squares off the band it is supposed to sit inside.
    overflow: 'hidden',
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: radius.xxl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  // Inset, so a square logo does not sit corner-to-corner in a rounded tile.
  logoImage: { width: 62, height: 62 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: brand.orange,
    marginBottom: spacing.lg,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: brand.orangeLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.heavy,
    color: colors.textInverse,
    textAlign: 'center',
    // Display sizes want tightening, not spacing out.
    letterSpacing: -0.4,
    lineHeight: fontSize.xxl * 1.25,
  },
  subtitle: {
    marginTop: spacing.md,
    fontSize: fontSize.sm,
    color: tone.faint,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 420,
  },
});
