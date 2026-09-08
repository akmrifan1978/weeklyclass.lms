import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as quranService from '@/services/quranService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { ScriptureText } from './ScriptureText';
import { MushafPage, arabicNumber, mushaf } from './MushafPage';
import { useRecitation } from './useRecitation';
import { AppHeader, Card, ErrorState, Screen, SkeletonList } from '@/components/ui';

/**
 * One surah, set as a mushaf page.
 *
 * Two ways to read it, and they are genuinely different activities. The mushaf
 * is for reading and reciting: continuous justified Arabic, the real page
 * breaks, nothing between the reader and the text. Turning the translation on
 * switches to verse by verse, because a translation belongs beside the verse it
 * renders and there is nowhere to put it on a continuous page.
 *
 * Changing the language re-fetches the translation rather than the page — the
 * Arabic is the same text in every language. Every surah read is cached, so
 * coming back is instant and works with no connection.
 */

const SIZE_KEY = '@weeklyclass/quran/textSize';
const MIN_SIZE = 20;
const MAX_SIZE = 46;
const STEP = 3;

/**
 * The size to start at, before anybody has chosen one.
 *
 * Justified text is only as good as the number of words it has to spread across
 * a line: set too large for the screen it is on, a line of four words is pulled
 * apart into four columns and the page stops reading as a page. So the opening
 * size follows the width rather than being one number everywhere. Once a reader
 * picks a size it is theirs, on every screen, and this stops applying.
 */
function defaultSizeFor(width: number): number {
  if (width < 400) return 22;
  if (width < 720) return 26;
  return 29;
}

export function SurahScreen({
  number,
  headerTint,
}: {
  number: number;
  headerTint?: string;
}) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageScope('quran');

  const load = useCallback(
    () => quranService.getSurah(number, language),
    [number, language]
  );
  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const { width } = useWindowDimensions();
  const [chosenSize, setChosenSize] = useState<number | null>(null);
  const size = chosenSize ?? defaultSizeFor(width);
  const [translating, setTranslating] = useState(false);
  const recitation = useRecitation();

  // Reading size is a property of the reader's eyes, not of the surah, so it is
  // remembered rather than reset each time one is opened.
  useEffect(() => {
    void AsyncStorage.getItem(SIZE_KEY)
      .then((stored) => {
        const value = Number(stored);
        if (value >= MIN_SIZE && value <= MAX_SIZE) setChosenSize(value);
      })
      .catch(() => undefined);
  }, []);

  const zoom = (delta: number) => {
    setChosenSize((current) => {
      const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, (current ?? size) + delta));
      void AsyncStorage.setItem(SIZE_KEY, String(next)).catch(() => undefined);
      return next;
    });
  };

  // Leaving one surah must not leave its recitation playing over the next.
  const { stop } = recitation;
  useEffect(() => stop, [number, stop]);

  const tracks = useMemo(
    () =>
      (data?.ayahs ?? []).map((ayah) => ({
        key: String(ayah.number),
        url: quranService.ayahAudioUrl(ayah.globalNumber),
      })),
    [data]
  );

  const playFrom = (ayahNumber: number) => {
    const index = tracks.findIndex((track) => track.key === String(ayahNumber));
    recitation.play(index < 0 ? tracks : tracks.slice(index));
  };

  const activeAyah = recitation.current ? Number(recitation.current) : null;
  const hasTranslation = Boolean(data?.translationEdition);

  /**
   * The opening basmala, lifted off the first verse.
   *
   * The edition prefixes it to verse 1, where the published translations do not
   * account for it — Al-Baqara's first verse came out as the basmala followed by
   * three letters, rendered "Alif, Lam, Meem". Splitting it out is the same
   * thing the mushaf page does, for the same reason: it is a heading over the
   * surah, not part of the verse under it.
   */
  const verses = useMemo(() => {
    if (!data) return [];
    return data.ayahs.map((ayah) => ({
      ayah,
      ...quranService.splitBasmala(data.number, ayah.number, ayah.arabic),
    }));
  }, [data]);
  const opening = verses[0]?.basmala ?? null;

  return (
    <>
      <AppHeader
        title={data?.englishName ?? t('nav.quran')}
        subtitle={data ? data.englishNameTranslation : undefined}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />

      <Screen refreshing={refreshing} onRefresh={refresh} edges={[]}>
        {loading ? (
          <SkeletonList count={6} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : data ? (
          <>
            {/* The strip a printed mushaf carries across the head of the page:
                where you are in the thirty parts, whose reading you are
                hearing, and which surah this is. */}
            <View style={styles.banner}>
              <Text style={styles.bannerCell} numberOfLines={1}>
                {t('quran.juzNumber', { juz: data.ayahs[0]?.juz ?? 1 })}
              </Text>
              <View style={styles.bannerRule} />
              <Text style={[styles.bannerCell, styles.bannerCentre]} numberOfLines={1}>
                {quranService.RECITER_NAME}
              </Text>
              <View style={styles.bannerRule} />
              <Text style={[styles.bannerCell, styles.bannerArabic]} numberOfLines={1}>
                {data.name}
              </Text>
            </View>

            {recitation.failed ? (
              <Text style={styles.notice}>{t('quran.audioUnavailable')}</Text>
            ) : null}

            {translating && hasTranslation ? (
              <>
                {opening ? (
                  <Card style={styles.opening}>
                    <Text style={[styles.openingText, { fontSize: size * 0.86 }]}>
                      {opening}
                    </Text>
                  </Card>
                ) : null}

                {verses.map(({ ayah, text }) => (
                <Card key={ayah.number} style={styles.verse}>
                  <ScriptureText
                    arabic={text}
                    arabicSize={size}
                    translation={
                      ayah.translation
                        ? {
                            text: ayah.translation,
                            language,
                            source: quranService.translationSourceFor(language),
                          }
                        : null
                    }
                    badge={
                      <Pressable
                        onPress={() => playFrom(ayah.number)}
                        accessibilityRole="button"
                        accessibilityLabel={t('quran.playRecitation')}
                        style={[
                          styles.badge,
                          activeAyah === ayah.number ? styles.badgeActive : null,
                        ]}
                      >
                        <Text style={styles.badgeText}>{arabicNumber(ayah.number)}</Text>
                      </Pressable>
                    }
                  />
                </Card>
                ))}
              </>
            ) : (
              <MushafPage
                surah={data.number}
                ayahs={data.ayahs}
                size={size}
                activeAyah={activeAyah}
                onSelectAyah={(ayah) => playFrom(ayah.number)}
                pageLabel={(page) => arabicNumber(page)}
              />
            )}

            {!hasTranslation ? (
              <Text style={styles.notice}>{t('quran.arabicOnly')}</Text>
            ) : null}
          </>
        ) : null}
      </Screen>

      {/* Outside the scroll view. Zoom you have to scroll two hundred verses to
          reach is zoom nobody uses. */}
      <SafeAreaView edges={['bottom']} style={styles.toolbarSafe}>
        <View style={styles.toolbar}>
          <ToolButton
            icon="remove"
            label={t('quran.smallerText')}
            onPress={() => zoom(-STEP)}
            disabled={size <= MIN_SIZE}
          />
          <ToolButton
            icon="add"
            label={t('quran.largerText')}
            onPress={() => zoom(STEP)}
            disabled={size >= MAX_SIZE}
          />

          <View style={styles.toolbarRule} />

          <ToolButton
            icon={recitation.playing ? 'stop' : 'play'}
            label={t(recitation.playing ? 'quran.stopRecitation' : 'quran.playRecitation')}
            onPress={() => (recitation.playing ? recitation.stop() : playFrom(1))}
            disabled={tracks.length === 0}
            active={recitation.playing}
          />

          {hasTranslation ? (
            <>
              <View style={styles.toolbarRule} />
              <ToolButton
                icon="language"
                label={t(translating ? 'quran.hideTranslation' : 'quran.showTranslation')}
                onPress={() => setTranslating((on) => !on)}
                active={translating}
                wide
              />
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  disabled,
  active,
  wide,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      style={({ pressed }) => [
        styles.tool,
        wide ? styles.toolWide : null,
        active ? styles.toolActive : null,
        disabled ? styles.toolDisabled : null,
        pressed && !disabled ? styles.toolPressed : null,
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={active ? colors.textInverse : disabled ? mushaf.rule : mushaf.label}
      />
      {wide ? (
        <Text style={[styles.toolLabel, active ? styles.toolLabelActive : null]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: mushaf.paperEdge,
    borderWidth: 1,
    borderColor: mushaf.frameSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  bannerCell: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: mushaf.label,
  },
  bannerCentre: { textAlign: 'center' },
  bannerArabic: { textAlign: 'right', writingDirection: 'rtl', fontSize: fontSize.sm },
  bannerRule: { width: 1, alignSelf: 'stretch', backgroundColor: mushaf.frameSoft },

  notice: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 18,
  },

  opening: { marginBottom: spacing.md, alignItems: 'center' },
  openingText: {
    color: mushaf.ink,
    textAlign: 'center',
    writingDirection: 'rtl',
    lineHeight: 56,
  },
  verse: { marginBottom: spacing.md },
  badge: {
    minWidth: 30,
    height: 26,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: mushaf.paperEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: { backgroundColor: mushaf.highlight },
  badgeText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: mushaf.marker },

  toolbarSafe: { backgroundColor: mushaf.paper },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: mushaf.frameSoft,
  },
  // minWidth rather than width: the labelled button has to be able to grow to
  // fit its word, in four languages, and a fixed width silently clipped it.
  tool: {
    minWidth: 44,
    height: 38,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mushaf.paperEdge,
  },
  toolWide: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    flexShrink: 1,
  },
  toolActive: { backgroundColor: mushaf.frame },
  toolDisabled: { opacity: 0.5 },
  toolPressed: { opacity: 0.7 },
  toolLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: mushaf.label },
  toolLabelActive: { color: colors.textInverse },
  toolbarRule: { width: 1, height: 22, backgroundColor: mushaf.frameSoft },
});
