import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fontWeight, radius, spacing } from '@/constants/theme';
import type { Ayah } from '@/services/quranService';
import { splitBasmala } from '@/services/quranService';

/**
 * A surah set the way a printed mushaf sets it.
 *
 * The reader this replaces gave every verse its own card. That is the right
 * shape for studying one ayah and the wrong shape for reading: a page of the
 * Qur'an is continuous text, the verses run into one another, and the number at
 * the end of each is a small ornament rather than a heading. Cards turned a
 * page of scripture into a list of records, and broke the thing a reciter
 * actually uses the page for — knowing, by its shape, where on the page they
 * are.
 *
 * So: one justified block per mushaf page, verse-end markers inline, the page
 * number centred between rules at the foot. The page boundaries are the real
 * ones from the printed mushaf, which is what makes "page 4" mean the same
 * thing here as it does in the copy on somebody's shelf.
 */

/**
 * The mushaf's own palette, kept here rather than in the app theme.
 *
 * Navy and orange are the centre's brand and belong on its chrome. A page of
 * the Qur'an is not chrome, and printing it in a brand colour would be a
 * strange thing to do; this is the sage and cream of the printed copy instead.
 */
export const mushaf = {
  paper: '#F4F6EC',
  paperEdge: '#E7EDDC',
  frame: '#8AA37F',
  frameSoft: '#C3D4B8',
  rule: '#CBD9C1',
  ink: '#1C2B20',
  marker: '#A07C36',
  label: '#556B4E',
  highlight: '#DDEBC8',
} as const;

const ARABIC_DIGITS = ['\u0660', '\u0661', '\u0662', '\u0663', '\u0664', '\u0665', '\u0666', '\u0667', '\u0668', '\u0669'];

/** 286 -> ٢٨٦. The numbers on the page are the ones printed on the page. */
export function arabicNumber(value: number): string {
  return String(value)
    .split('')
    .map((digit) => ARABIC_DIGITS[Number(digit)] ?? digit)
    .join('');
}

/**
 * The end-of-verse ornament.
 *
 * Ornate parentheses rather than U+06DD, the dedicated "end of ayah" sign.
 * U+06DD is the more correct character and renders as a decorated circle in
 * fonts that carry it — and as a dotted placeholder box in the ones that do
 * not, which on Android is a real possibility. These two are presentation forms
 * every Arabic font ships, so the page always looks like a page.
 */
function verseMark(number: number): string {
  return `\uFD3F${arabicNumber(number)}\uFD3E`;
}

interface MushafSheet {
  page: number;
  juz: number;
  /** Set only on the page that opens the surah. */
  basmala: string | null;
  ayahs: { ayah: Ayah; text: string }[];
}

/** Cuts the surah at the page boundaries the printed mushaf uses. */
function toSheets(surah: number, ayahs: Ayah[]): MushafSheet[] {
  const sheets: MushafSheet[] = [];

  for (const ayah of ayahs) {
    const { basmala, text } = splitBasmala(surah, ayah.number, ayah.arabic);

    let sheet = sheets[sheets.length - 1];
    if (!sheet || sheet.page !== ayah.page) {
      sheet = { page: ayah.page, juz: ayah.juz, basmala: null, ayahs: [] };
      sheets.push(sheet);
    }

    if (basmala) sheet.basmala = basmala;
    // A verse that was nothing but the basmala — there is no such verse outside
    // Al-Fatiha, where it is never split — would otherwise leave an empty run
    // carrying a verse number.
    if (text.length > 0) sheet.ayahs.push({ ayah, text });
  }

  return sheets;
}

export function MushafPage({
  surah,
  ayahs,
  size,
  activeAyah,
  onSelectAyah,
  pageLabel,
}: {
  surah: number;
  ayahs: Ayah[];
  /** Arabic point size, driven by the reader's zoom controls. */
  size: number;
  /** Verse currently being recited, highlighted so it can be followed. */
  activeAyah?: number | null;
  onSelectAyah?: (ayah: Ayah) => void;
  /** Renders the page number, so the caller owns the wording and the locale. */
  pageLabel: (page: number) => string;
}) {
  const sheets = useMemo(() => toSheets(surah, ayahs), [surah, ayahs]);

  // Arabic diacritics sit well above and below the line and collide at ordinary
  // spacing, so the leading grows with the size rather than staying a ratio a
  // Latin face would use.
  const lineHeight = Math.round(size * 2.05);

  return (
    <View style={styles.frame}>
      <View style={styles.page}>
        {sheets.map((sheet) => (
          <View key={sheet.page}>
            {sheet.basmala ? (
              <Text
                style={[styles.basmala, { fontSize: size * 0.86, lineHeight: lineHeight * 0.9 }]}
              >
                {sheet.basmala}
              </Text>
            ) : null}

            <Text style={[styles.body, { fontSize: size, lineHeight }]}>
              {sheet.ayahs.map(({ ayah, text }) => (
                <Text
                  key={ayah.number}
                  onPress={onSelectAyah ? () => onSelectAyah(ayah) : undefined}
                  suppressHighlighting
                  style={activeAyah === ayah.number ? styles.active : undefined}
                >
                  {text}
                  <Text style={styles.mark}>{` ${verseMark(ayah.number)} `}</Text>
                </Text>
              ))}
            </Text>

            <View style={styles.footer}>
              <View style={styles.rule} />
              <Text style={styles.pageNumber}>{pageLabel(sheet.page)}</Text>
              <View style={styles.rule} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Two borders with a gap between them: the double rule around a printed page.
  frame: {
    borderWidth: 2,
    borderColor: mushaf.frame,
    borderRadius: radius.lg,
    padding: spacing.xs,
    backgroundColor: mushaf.paperEdge,
    marginBottom: spacing.lg,
  },
  page: {
    borderWidth: 1,
    borderColor: mushaf.frameSoft,
    borderRadius: radius.md,
    backgroundColor: mushaf.paper,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  basmala: {
    color: mushaf.ink,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginBottom: spacing.md,
  },
  body: {
    color: mushaf.ink,
    textAlign: 'justify',
    writingDirection: 'rtl',
  },
  active: { backgroundColor: mushaf.highlight },
  mark: { color: mushaf.marker, fontWeight: fontWeight.bold },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  rule: { flex: 1, height: 1, backgroundColor: mushaf.rule },
  // The page number is how a reciter says where they are, so it is set to be
  // read across a room rather than squinted at.
  pageNumber: {
    fontSize: 17,
    color: mushaf.label,
    fontWeight: fontWeight.bold,
    minWidth: 34,
    textAlign: 'center',
  },
});
