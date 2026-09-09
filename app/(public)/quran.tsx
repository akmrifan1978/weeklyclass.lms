import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import {
  ListState,
  PublicCard,
  SearchBar,
  SignInPrompt,
  Tag,
} from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { listSurahs, type SurahSummary } from '@/services/quranService';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';

/**
 * The index of the Qur'an, open to anybody.
 *
 * The surah list comes from a public API and belongs to no account, so there is
 * nothing here to gate and nothing to mirror — this page works signed out
 * because the data was never private in the first place.
 *
 * The reader itself stays inside the app. Translation in four languages,
 * recitation, the daily reading plan and the place you left off are all tied to
 * a person, and a page with no person cannot offer them.
 */
export default function PublicQuran() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const load = useCallback(() => listSurahs().catch(() => [] as SurahSummary[]), []);
  const { data, loading, refreshing, refresh } = useAsync(load, []);

  const surahs = useMemo(() => {
    const rows = data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (surah) =>
        surah.englishName.toLowerCase().includes(needle) ||
        surah.englishNameTranslation.toLowerCase().includes(needle) ||
        surah.name.includes(query.trim()) ||
        String(surah.number) === needle
    );
  }, [data, query]);

  return (
    <PublicPage
      badge={t('public.quran.badge')}
      title={t('public.quran.title')}
      subtitle={t('public.quran.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <SearchBar value={query} onChange={setQuery} placeholder={t('quran.searchSurah')} />

      <ListState
        loading={loading}
        empty={surahs.length === 0}
        icon="book-outline"
        title={t('public.quran.emptyTitle')}
        message={t('public.quran.emptyBody')}
      />

      {surahs.length > 0 ? <SignInPrompt message={t('public.quran.readerNote')} /> : null}

      {surahs.map((surah) => (
        <SurahRow key={surah.number} surah={surah} />
      ))}
    </PublicPage>
  );
}

function SurahRow({ surah }: { surah: SurahSummary }) {
  const { t } = useTranslation();

  return (
    <PublicCard>
      <View style={styles.row}>
        {/* The number in a diamond, as a mushaf marks it. */}
        <View style={styles.number}>
          <Text style={styles.numberText}>{surah.number}</Text>
        </View>

        <View style={styles.details}>
          <Text style={styles.english}>{surah.englishName}</Text>
          <Text style={styles.meaning} numberOfLines={1}>
            {surah.englishNameTranslation}
          </Text>
        </View>

        <Text style={styles.arabic} numberOfLines={1}>
          {surah.name}
        </Text>
      </View>

      <View style={styles.tags}>
        <Tag
          label={t(surah.revelationType === 'Meccan' ? 'quran.meccan' : 'quran.medinan')}
          tone="muted"
        />
        <Tag label={t('quran.ayahCount', { count: surah.numberOfAyahs })} />
      </View>
    </PublicCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  number: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: brand.orangeDark,
  },
  details: { flex: 1 },
  english: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: brand.navyDeep },
  meaning: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  arabic: {
    fontSize: fontSize.lg,
    color: brand.navy,
    fontWeight: fontWeight.semibold,
    // Arabic sits low in its line box at this size; a little extra height stops
    // the descenders being clipped by the row above.
    lineHeight: 30,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
