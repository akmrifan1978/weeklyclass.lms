import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import type { LanguageCode } from '@/types';

/**
 * A compact language switcher for a dashboard header.
 *
 * It shows the language code rather than a globe icon, because the point is to
 * tell you at a glance which language THIS dashboard is in — which may differ
 * from the one next door, and that is the whole feature.
 */
export function LanguageMenu({
  value,
  onChange,
  tint = colors.textInverse,
}: {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void | Promise<void>;
  /** Header text colour, so this reads correctly on navy and on white. */
  tint?: string;
}) {
  const { t } = useTranslation();
  const { available } = useLanguage();
  const [open, setOpen] = useState(false);

  const current = available.find((l) => l.code === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.language')}
        accessibilityValue={{ text: current?.name ?? value }}
        style={({ pressed }) => [
          styles.trigger,
          { borderColor: tint },
          pressed ? styles.triggerPressed : null,
        ]}
        hitSlop={8}
      >
        <Ionicons name="language-outline" size={15} color={tint} />
        <Text style={[styles.triggerText, { color: tint }]}>{value.toUpperCase()}</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessible={false}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {t('settings.language')}
            </Text>
            <Text style={styles.sheetHint}>{t('settings.languageScopeHint')}</Text>

            {available.map((option) => {
              const selected = option.code === value;
              return (
                <Pressable
                  key={option.code}
                  onPress={() => {
                    setOpen(false);
                    void onChange(option.code as LanguageCode);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.option,
                    selected ? styles.optionSelected : null,
                    pressed ? styles.optionPressed : null,
                  ]}
                >
                  <View style={styles.optionText}>
                    <Text style={styles.optionNative}>{option.nativeName}</Text>
                    <Text style={styles.optionName}>{option.name}</Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    minHeight: 30,
  },
  triggerPressed: { opacity: 0.6 },
  triggerText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    ...shadow.lg,
  },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  sheetHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 17,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  optionSelected: { backgroundColor: colors.accentSoft },
  optionPressed: { backgroundColor: colors.surfaceMuted },
  optionText: { flex: 1 },
  // Aligned explicitly rather than left to the text's own direction. On 'auto',
  // العربية aligned itself to the right while every other row sat on the left,
  // which read as a broken row rather than as a language choice.
  optionNative: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: fontWeight.medium,
    textAlign: 'left',
  },
  optionName: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
    textAlign: 'left',
  },
});
