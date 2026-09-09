import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { matchesSearch } from '@/utils/format';
import {
  DUAS,
  DUA_CATEGORY_KEYS,
  QURAN_DUAS,
  hasApprovedMeaning,
  type DuaCategory,
} from '@/constants/duas';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import * as translateService from '@/services/translateService';
import * as quranService from '@/services/quranService';
import { ScriptureText } from './ScriptureText';
import {
  AppHeader,
  Card,
  EmptyState,
  Screen,
  SearchField,
  SectionHeader,
} from '@/components/ui';

const ORDER: DuaCategory[] = [
  'daily',
  'prayer',
  'food',
  'travel',
  'distress',
  'protection',
];

/**
 * Authentic supplications, grouped by when you need them.
 *
 * Grouped by occasion rather than listed alphabetically, because nobody looks
 * for a duʿāʾ by name — they look for "the one before eating" or "the one when
 * something goes wrong".
 *
 * Each shows the Arabic first, then a transliteration, then the meaning, then
 * its source. That order is deliberate: the Arabic is the supplication, the
 * transliteration helps someone say it who cannot read the script, and the
 * meaning explains it. The reference is what makes "authentic" checkable rather
 * than a claim.
 */
export function DuaScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageScope('dua');
  const [search, setSearch] = useState('');

  // English is currently the only language with a written, checked meaning for
  // every supplication.
  const meaningApproved = hasApprovedMeaning(language);

  /**
   * Where the reader's language has no written meaning, the English one is
   * shown and named as English — the Arabic used to stand alone, which left a
   * Tamil reader with the supplication and no idea what they were saying.
   *
   * Arabic readers are the exception: the duʿāʾ is the Arabic, so a second
   * language underneath would be clutter rather than help.
   */
  const showEnglishMeaning = !meaningApproved && language !== 'ar';

  const [glosses, setGlosses] = useState<
    Record<string, { text?: string; loading?: boolean; error?: string }>
  >({});

  const requestGloss = useCallback(
    async (id: string, english: string) => {
      setGlosses((g) => ({ ...g, [id]: { loading: true } }));
      try {
        const text = await translateService.translate(english, 'en', language);
        setGlosses((g) => ({ ...g, [id]: { text } }));
      } catch (err) {
        const reason =
          err instanceof translateService.TranslationUnavailable ? err.reason : 'network';
        setGlosses((g) => ({ ...g, [id]: { error: t(`scripture.translateFailed_${reason}`) } }));
      }
    },
    [language, t]
  );

  /**
   * The Qur'anic supplications, fetched rather than bundled.
   *
   * Both the verse and its meaning come from the approved editions the Qur'an
   * screen uses, so nothing here is typed by hand or machine-translated — which
   * for revelation is not a preference but the rule this app is built on.
   *
   * All ten at once and cached after the first time, so the section costs one
   * round of small requests ever rather than one per supplication per visit.
   */
  const loadQuranDuas = useCallback(
    () =>
      Promise.all(
        QURAN_DUAS.map(async (dua) => ({
          ...dua,
          verse: await quranService.getAyah(dua.surah, dua.ayah, language),
        }))
      ),
    [language]
  );
  const { data: quranDuas } = useAsync(loadQuranDuas, [loadQuranDuas]);

  /** Qur'anic supplications matching the search, or all of them when empty. */
  const quranMatching = useMemo(
    () =>
      (quranDuas ?? []).filter(
        (dua) =>
          !search.trim() ||
          matchesSearch(search, t(dua.titleKey), dua.verse.arabic, dua.verse.translation ?? '')
      ),
    [quranDuas, search, t]
  );

  const grouped = useMemo(() => {
    const matching = DUAS.filter((dua) =>
      matchesSearch(
        search,
        t(dua.titleKey),
        meaningApproved
          ? t(dua.meaningKey)
          : language !== 'ar'
            ? t(dua.meaningKey, { lng: 'en' })
            : undefined,
        dua.transliteration,
        dua.arabic,
        dua.reference
      )
    );
    return ORDER.map((category) => ({
      category,
      duas: matching.filter((dua) => dua.category === category),
    })).filter((group) => group.duas.length > 0);
  }, [search, t, meaningApproved, language]);

  return (
    <>
      <AppHeader
        title={t('nav.duas')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('dua.search')}
        />

        <Card style={styles.notice}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
          <Text style={styles.noticeText}>{t('dua.sourceNote')}</Text>
        </Card>

        {/* The Qur'an first, and separately, because a supplication that is
            revelation is not the same kind of thing as one a Companion
            narrated — and a reader is entitled to see which is which without
            having to read a reference line to find out. */}
        {quranMatching.length > 0 ? (
          <>
            <SectionHeader title={t('dua.fromQuran')} icon="book-outline" />
            <Card style={styles.notice}>
              <Ionicons name="information-circle-outline" size={18} color={colors.info} />
              <Text style={styles.noticeText}>{t('dua.quranWholeVerseNote')}</Text>
            </Card>

            {quranMatching.map((dua) => (
              <Card key={dua.id} style={styles.card}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{t(dua.titleKey)}</Text>
                </View>

                <ScriptureText
                  arabic={dua.verse.arabic}
                  arabicSize={24}
                  translation={
                    dua.verse.translation
                      ? {
                          text: dua.verse.translation,
                          language,
                          source: dua.verse.translationSource,
                        }
                      : null
                  }
                />

                <Text style={styles.reference}>
                  {dua.verse.surahName} {dua.verse.surah}:{dua.verse.ayah}
                </Text>
              </Card>
            ))}
          </>
        ) : null}

        {/* Everything narrated, under its own heading so the split is stated
            rather than implied by ordering. */}
        {grouped.length > 0 ? (
          <SectionHeader title={t('dua.fromSunnah')} icon="sparkles-outline" />
        ) : null}

        {grouped.length === 0 && quranMatching.length === 0 ? (
          <EmptyState icon="search-outline" title={t('empty.noResults')} />
        ) : (
          grouped.map((group) => (
            <View key={group.category}>
              <SectionHeader
                title={t(DUA_CATEGORY_KEYS[group.category])}
                icon="sparkles-outline"
              />
              {group.duas.map((dua) => (
                <Card key={dua.id} style={styles.card}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{t(dua.titleKey)}</Text>
                    {dua.repeat ? (
                      <View style={styles.repeatChip}>
                        <Text style={styles.repeatText}>
                          {t('dua.times', { count: dua.repeat })}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <ScriptureText
                    arabic={dua.arabic}
                    arabicSize={24}
                    translation={
                      meaningApproved
                        ? { text: t(dua.meaningKey), language }
                        : showEnglishMeaning
                          ? // Read from the English bundle explicitly rather
                            // than relying on the fallback chain, so this says
                            // what it means: the English text, labelled English.
                            { text: t(dua.meaningKey, { lng: 'en' }), language: 'en' }
                          : null
                    }
                    machine={
                      showEnglishMeaning
                        ? {
                            text: glosses[dua.id]?.text ?? null,
                            language,
                            loading: glosses[dua.id]?.loading,
                            error: glosses[dua.id]?.error,
                            onRequest: () =>
                              void requestGloss(dua.id, t(dua.meaningKey, { lng: 'en' })),
                          }
                        : null
                    }
                  />

                  {/* The transliteration is a pronunciation aid, not a
                      translation — it carries no meaning and is shown in every
                      language. */}
                  <Text style={styles.transliteration}>{dua.transliteration}</Text>

                  <View style={styles.refRow}>
                    <Ionicons name="bookmark-outline" size={12} color={brand.orange} />
                    <Text style={styles.reference}>{dua.reference}</Text>
                  </View>
                </Card>
              ))}
            </View>
          ))
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  card: { marginBottom: spacing.md },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  repeatChip: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  repeatText: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.bold },
  // Arabic gets the size and line height it needs; the diacritics collide at
  // body size, the same reason the Qur'an screens do this.
  arabic: {
    fontSize: 24,
    lineHeight: 48,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: spacing.md,
  },
  transliteration: {
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: colors.primary,
    fontStyle: 'italic',
    marginTop: spacing.md,
  },
  meaning: {
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  reference: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.semibold },
});
