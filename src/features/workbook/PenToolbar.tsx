import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing, TOUCH_TARGET } from '@/constants/theme';
import {
  HIGHLIGHT_COLORS,
  PEN_COLORS,
  PEN_WIDTHS,
  type PenTool,
} from './strokes';

/**
 * What the hand reaches for while writing.
 *
 * Laid out as one horizontal strip that stays put while the page scrolls,
 * because a teacher mid-sentence should not have to go looking for the eraser.
 *
 * The colour swatches change with the tool: pen colours are ink, highlighter
 * colours are transparent marker. Showing both sets at once would offer a
 * yellow that means two different things depending on a button pressed
 * somewhere else on the strip.
 */
export function PenToolbar({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  onUndo,
  onClear,
  canUndo,
}: {
  tool: PenTool;
  onTool: (tool: PenTool) => void;
  color: string;
  onColor: (color: string) => void;
  width: number;
  onWidth: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}) {
  const { t } = useTranslation();

  const tools: { value: PenTool; icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
    { value: 'pen', icon: 'create-outline', key: 'workbook.pen' },
    { value: 'highlighter', icon: 'color-fill-outline', key: 'workbook.highlighter' },
    { value: 'eraser', icon: 'backspace-outline', key: 'workbook.eraser' },
  ];

  const swatches = tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS;

  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {tools.map((item) => {
          const active = tool === item.value;
          return (
            <Pressable
              key={item.value}
              onPress={() => onTool(item.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(item.key)}
              style={[styles.tool, active && styles.toolActive]}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={active ? colors.textInverse : colors.textSecondary}
              />
              <Text style={[styles.toolText, active && styles.toolTextActive]}>
                {t(item.key)}
              </Text>
            </Pressable>
          );
        })}

        <View style={styles.sep} />

        {/* The eraser has no colour and no nib size, so the rest of the strip
            steps aside rather than sitting there doing nothing. */}
        {tool !== 'eraser' ? (
          <>
            {swatches.map((swatch) => {
              const active = color === swatch.value;
              return (
                <Pressable
                  key={swatch.value}
                  onPress={() => onColor(swatch.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t(swatch.key)}
                  style={[styles.swatchTap]}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: swatch.value },
                      active && styles.swatchActive,
                    ]}
                  />
                </Pressable>
              );
            })}

            {tool === 'pen' ? (
              <>
                <View style={styles.sep} />
                {PEN_WIDTHS.map((w) => {
                  const active = width === w;
                  return (
                    <Pressable
                      key={w}
                      onPress={() => onWidth(w)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t('workbook.nib', { size: w })}
                      style={[styles.nibTap, active && styles.nibTapActive]}
                    >
                      {/* The button shows the actual weight of the line it
                          selects, which needs no label in any language. */}
                      <View
                        style={{
                          width: 26,
                          height: Math.max(2, w / 2),
                          borderRadius: 999,
                          backgroundColor: active ? colors.primary : colors.textSecondary,
                        }}
                      />
                    </Pressable>
                  );
                })}
              </>
            ) : null}
          </>
        ) : null}

        <View style={styles.sep} />

        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel={t('workbook.undo')}
          style={[styles.tool, !canUndo && styles.disabled]}
        >
          <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.toolText}>{t('workbook.undo')}</Text>
        </Pressable>

        <Pressable
          onPress={onClear}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel={t('workbook.clearPage')}
          style={[styles.tool, !canUndo && styles.disabled]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={[styles.toolText, { color: colors.danger }]}>
            {t('workbook.clearPage')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toolText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  toolTextActive: { color: colors.textInverse },
  disabled: { opacity: 0.4 },
  sep: { width: 1, height: 24, backgroundColor: colors.borderStrong, marginHorizontal: spacing.xs },
  swatchTap: {
    width: TOUCH_TARGET - 8,
    height: TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: { width: 26, height: 26, borderRadius: 999, borderWidth: 2, borderColor: colors.surface },
  swatchActive: { borderColor: colors.primary, transform: [{ scale: 1.15 }] },
  nibTap: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  nibTapActive: { backgroundColor: colors.surface },
});
