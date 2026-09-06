import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { LANGUAGES } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import type { LanguageCode } from '@/types';

/**
 * Arabic scripture with an optional, approved translation beside it.
 *
 * THE RULE THIS ENFORCES, in one place so no screen can quietly break it:
 *
 *   1. The Arabic is shown verbatim, always, in Arabic script, whatever the app
 *      language is set to. It is never transliterated, reflowed, or replaced.
 *   2. A translation appears only when an APPROVED one exists for the selected
 *      language — a published edition or text a person wrote and checked.
 *   3. Where none exists there is no translation, and no toggle offering one.
 *      A machine rendering of a verse, a hadith or a fatwa is not shown, ever.
 *   4. The two are labelled. A reader must be able to tell at a glance which
 *      words are the original and which are somebody's rendering of them.
 *
 * Passing `translation: null` is how a caller says "nothing approved here", and
 * it is the correct thing to pass whenever there is any doubt.
 */

export interface ApprovedTranslation {
  text: string;
  /** The language the translation is actually in, which may not be the app's. */
  language: LanguageCode;
  /** Published edition or translator, shown so the reader can weigh it. */
  source?: string;
}

export function ScriptureText({
  arabic,
  translation,
  /** Shown above the Arabic, e.g. an ayah or hadith number. */
  badge,
  /** Larger for a single ayah, smaller inside a dense list. */
  arabicSize = 26,
  defaultOpen = true,
}: {
  arabic: string;
  translation: ApprovedTranslation | null;
  badge?: React.ReactNode;
  arabicSize?: number;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const languageName =
    LANGUAGES.find((l) => l.code === translation?.language)?.name ??
    translation?.language ??
    '';

  return (
    <View>
      {badge ? <View style={styles.badgeRow}>{badge}</View> : null}

      {/*
        `selectable` so someone can copy the Arabic exactly as it stands —
        diacritics and all — rather than retyping and losing them.
      */}
      <Text
        style={[styles.arabic, { fontSize: arabicSize, lineHeight: arabicSize * 2 }]}
        accessibilityLanguage="ar"
        selectable
      >
        {arabic}
      </Text>

      {translation ? (
        <>
          <Pressable
            onPress={() => setOpen((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: open }}
            accessibilityLabel={t('scripture.toggleTranslation')}
            style={styles.toggle}
          >
            <Ionicons
              name={open ? 'eye-outline' : 'eye-off-outline'}
              size={14}
              color={colors.textMuted}
            />
            <Text style={styles.toggleLabel}>
              {t('scripture.approvedTranslation', { language: languageName })}
            </Text>
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textMuted}
            />
          </Pressable>

          {open ? (
            <View style={styles.translationBlock}>
              <Text style={styles.translation}>{translation.text}</Text>
              {translation.source ? (
                <Text style={styles.source}>{translation.source}</Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        // No toggle at all — offering one that cannot be turned on would only
        // suggest a translation exists somewhere out of reach.
        <View style={styles.unavailable}>
          <Ionicons name="information-circle-outline" size={13} color={colors.textMuted} />
          <Text style={styles.unavailableText}>{t('scripture.noApprovedTranslation')}</Text>
        </View>
      )}
    </View>
  );
}

/** The "Original Arabic" heading, for screens that show a block of scripture. */
export function OriginalArabicLabel() {
  const { t } = useTranslation();
  return (
    <View style={styles.originalRow}>
      <Ionicons name="book-outline" size={13} color={brand.orange} />
      <Text style={styles.originalText}>{t('scripture.originalArabic')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  // Arabic needs far more line height than Latin script: the diacritics sit
  // above and below the line and collide at normal spacing. Never scaled down
  // to fit — the text is the point.
  arabic: {
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  toggleLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: fontWeight.medium },
  translationBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  translation: { fontSize: fontSize.sm, lineHeight: 22, color: colors.textSecondary },
  source: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.md,
  },
  unavailableText: { flex: 1, fontSize: fontSize.xs, color: colors.textMuted },
  originalRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
  originalText: {
    fontSize: fontSize.xs,
    color: brand.orange,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
});
