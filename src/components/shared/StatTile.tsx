import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';

/**
 * One number, said plainly.
 *
 * A student's own figures existed and were never shown to them — attendance,
 * work handed in, lessons waiting — while the admin dashboard led with
 * statistics. This is that row, for the person the figures are actually about.
 *
 * The number carries the weight and the label explains it, rather than the
 * other way round: somebody glancing at their attendance wants the percentage,
 * not the word "attendance". The icon is tinted and boxed so a row of these
 * reads as a row rather than as four unrelated cards.
 */
export function StatTile({
  icon,
  value,
  label,
  hint,
  tint = colors.primary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** Already formatted — this does not decide what a percentage looks like. */
  value: string;
  label: string;
  /** The smaller line under it, where the number needs context. */
  hint?: string;
  tint?: string;
}) {
  return (
    <View style={styles.tile} accessibilityRole="summary" accessibilityLabel={`${label}: ${value}`}>
      <View style={[styles.iconBox, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>

      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // flexBasis rather than a fixed width: four of these wrap to two rows on a
  // phone and sit in one on a laptop, without either being told to.
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  value: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  label: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
