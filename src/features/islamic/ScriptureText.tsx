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
 *   3. Where none exists there is no approved translation and no toggle
 *      pretending otherwise.
 *   4. Everything is labelled. A reader must be able to tell at a glance which
 *      words are the original, which are a published rendering, and which are
 *      a machine's.
 *
 * Rule 3 used to end "a machine rendering is not shown, ever". That absolute
 * has been narrowed, at the platform owner's decision, to permit a machine
 * gloss of a HADITH only — and only as an extra block, never as a replacement,
 * always beneath the published English it was made from, and marked in warning
 * colours with the word "machine" in the label. A reader can therefore always
 * see what it was translated from and judge it accordingly.
 *
 * It remains absolute for the Qur'an. A rough gloss of a hadith sits next to
 * the English a reader can check it against; a rough gloss of the Qur'an is
 * handed to somebody as the meaning of revelation, and callers do not get the
 * option here.
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

export interface MachineGloss {
  /** The rendering itself, or null while it is being fetched or was refused. */
  text: string | null;
  language: LanguageCode;
  loading?: boolean;
  /** Message to show instead of the text — a quota, a refusal, no network. */
  error?: string | null;
  /** Absent when there is nothing left to ask for, e.g. it is already here. */
  onRequest?: () => void;
}

export function ScriptureText({
  arabic,
  translation,
  /**
   * A machine gloss, shown BENEATH the approved translation and never instead
   * of it. Hadith only — see the note at the top of this file.
   */
  machine,
  /** Shown above the Arabic, e.g. an ayah or hadith number. */
  badge,
  /** Larger for a single ayah, smaller inside a dense list. */
  arabicSize = 26,
  defaultOpen = true,
}: {
  arabic: string;
  translation: ApprovedTranslation | null;
  machine?: MachineGloss | null;
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

          {open && machine ? <MachineBlock gloss={machine} /> : null}
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

/**
 * The machine gloss.
 *
 * Deliberately does not look like the block above it: a warning-toned border,
 * its own icon, and a label that says "machine translation" before the reader
 * gets to the words. The published English stays on screen directly above, so
 * there is always something to check it against.
 */
function MachineBlock({ gloss }: { gloss: MachineGloss }) {
  const { t } = useTranslation();
  // The language named in its own script: a Tamil reader is told "தமிழ்", not
  // "TAMIL", which is the only word in the sentence they would have to be an
  // English reader to recognise.
  const languageName =
    LANGUAGES.find((l) => l.code === gloss.language)?.nativeName ?? gloss.language;

  if (gloss.error) {
    return (
      <View style={styles.machineBlock}>
        <Text style={styles.machineError}>{gloss.error}</Text>
      </View>
    );
  }

  if (gloss.loading) {
    return (
      <View style={styles.machineBlock}>
        <Text style={styles.machineLabel}>{t('scripture.translating')}</Text>
      </View>
    );
  }

  if (!gloss.text) {
    if (!gloss.onRequest) return null;
    return (
      <Pressable
        onPress={gloss.onRequest}
        accessibilityRole="button"
        style={styles.machineRequest}
      >
        <Ionicons name="sparkles-outline" size={13} color={brand.orange} />
        <Text style={styles.machineRequestText}>
          {t('scripture.translateWithMachine', { language: languageName })}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.machineBlock}>
      <View style={styles.machineHeader}>
        <Ionicons name="warning-outline" size={13} color={colors.warning} />
        <Text style={styles.machineLabel}>
          {t('scripture.machineTranslation', { language: languageName })}
        </Text>
      </View>
      <Text style={styles.machineText}>{gloss.text}</Text>
      <Text style={styles.machineCaveat}>{t('scripture.machineCaveat')}</Text>
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
  machineRequest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: brand.orange,
  },
  machineRequestText: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.semibold },
  machineBlock: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  machineHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  machineLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.warning,
    letterSpacing: 0.4,
  },
  machineText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  machineCaveat: { fontSize: 10, color: colors.textSecondary, marginTop: 6, lineHeight: 14 },
  machineError: { fontSize: fontSize.xs, color: colors.danger },
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
