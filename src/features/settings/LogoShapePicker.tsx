import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { LOGO_SHAPES, logoImageStyle } from '@/utils/branding';
import type { LogoShape } from '@/types';

/**
 * Round, square, or the logo's own shape.
 *
 * Each option previews the ACTUAL uploaded logo in that shape, because
 * "round" means something quite different for a wide wordmark than for a
 * square badge, and the admin should see which before choosing.
 *
 * Nothing selected is a real state: it leaves every logo exactly as it looked
 * before this setting existed.
 */
export function LogoShapePicker({
  value,
  logoUrl,
  onChange,
}: {
  value: LogoShape | null | undefined;
  logoUrl: string | null;
  onChange: (shape: LogoShape) => void;
}) {
  const { t } = useTranslation();
  const labels: Record<LogoShape, string> = {
    round: t('settings.shapeRound'),
    square: t('settings.shapeSquare'),
    original: t('settings.shapeOriginal'),
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('settings.logoShape')}</Text>
      <View style={styles.options}>
        {LOGO_SHAPES.map((shape) => {
          const on = value === shape;
          return (
            <Pressable
              key={shape}
              onPress={() => onChange(shape)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={labels[shape]}
              style={[styles.option, on && styles.optionOn]}
            >
              <View style={styles.previewBox}>
                {logoUrl ? (
                  <Image
                    source={{ uri: logoUrl }}
                    style={[styles.preview, logoImageStyle(shape, 56)]}
                    resizeMode="contain"
                  />
                ) : (
                  <Ionicons
                    name={shape === 'round' ? 'ellipse-outline' : shape === 'square' ? 'square-outline' : 'image-outline'}
                    size={36}
                    color={colors.textMuted}
                  />
                )}
              </View>
              <Text style={[styles.optionText, on && styles.optionTextOn]}>{labels[shape]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('settings.logoShapeHint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    flexGrow: 1,
    flexBasis: 90,
    maxWidth: 160,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  optionOn: { borderColor: colors.primary },
  previewBox: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  preview: { width: 56, height: 56 },
  optionText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  optionTextOn: { color: colors.primary },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 17, marginTop: spacing.sm },
});
