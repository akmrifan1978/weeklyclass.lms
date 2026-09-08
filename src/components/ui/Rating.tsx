import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, spacing, TOUCH_TARGET } from '@/constants/theme';

/**
 * Five stars, with the chosen one named underneath.
 *
 * The word matters more than the star. Star scales are read differently by
 * different people — three out of five is "fine" to one person and "something
 * is wrong" to another — so the app says which it means: very bad, bad, okay,
 * good, very good. That also makes the control usable by somebody who cannot
 * see the stars, and by somebody reading the app in Tamil where a five-star
 * convention carries no particular meaning.
 *
 * No default selection. A pre-filled rating is an opinion the app has put in
 * somebody's mouth, and it would be counted in the average as though they had
 * held it.
 */
export function Rating({
  value,
  onChange,
  label,
  disabled,
}: {
  /** 1-5, or null for "not rated". */
  value: number | null;
  onChange: (value: number) => void;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = value !== null && star <= value;
          return (
            <Pressable
              key={star}
              onPress={() => !disabled && onChange(star)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === star, disabled }}
              accessibilityLabel={t(`rating.level_${star}`)}
              hitSlop={4}
              style={({ pressed }) => [styles.star, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons
                name={filled ? 'star' : 'star-outline'}
                size={30}
                color={filled ? brand.orange : colors.borderStrong}
              />
            </Pressable>
          );
        })}
      </View>

      {/* The space is held whether or not anything is chosen, so choosing does
          not shove the rest of the form down the screen. */}
      <Text style={[styles.word, value === null && styles.wordEmpty]}>
        {value === null ? t('rating.prompt') : t(`rating.level_${value}`)}
      </Text>
    </View>
  );
}

/** The same five stars, small and unpressable, for showing a rating already given. */
export function RatingBadge({ value }: { value: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.badge} accessibilityLabel={t(`rating.level_${value}`)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= value ? 'star' : 'star-outline'}
          size={13}
          color={star <= value ? brand.orange : colors.border}
        />
      ))}
      <Text style={styles.badgeText}>{t(`rating.level_${value}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  stars: { flexDirection: 'row', gap: spacing.xs },
  star: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: 2,
    minHeight: 20,
  },
  wordEmpty: { color: colors.textMuted, fontWeight: fontWeight.regular },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badgeText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
});
