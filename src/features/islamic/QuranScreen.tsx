import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import * as quranService from '@/services/quranService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AppHeader,
  Card,
  EmptyState,
  Screen,
  SearchField,
  SkeletonList,
} from '@/components/ui';

/**
 * The 114 surahs.
 *
 * The Qur'an dashboard keeps its own language, independent of the rest of the
 * app: the Arabic is always shown, and the language chosen here decides which
 * translation sits beside it. Choosing Arabic shows the Arabic alone.
 */
export function QuranScreen({
  basePath,
  headerTint,
}: {
  /** Route prefix of the dashboard this is mounted in, e.g. `/(student)`. */
  basePath: string;
  headerTint?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, setLanguage } = useLanguageScope('quran');
  const [search, setSearch] = useState('');

  const load = useCallback(() => quranService.listSurahs(), []);
  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const surahs = useMemo(
    () =>
      (data ?? []).filter((surah) =>
        matchesSearch(
          search,
          surah.englishName,
          surah.name,
          surah.englishNameTranslation,
          String(surah.number)
        )
      ),
    [data, search]
  );

  return (
    <>
      <AppHeader
        title={t('nav.quran')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('quran.searchSurah')}
        />

        {loading ? (
          <SkeletonList count={8} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : surahs.length === 0 ? (
          <EmptyState icon="search-outline" title={t('empty.noResults')} />
        ) : (
          <Card style={styles.list}>
            {surahs.map((surah) => (
              <Pressable
                key={surah.number}
                onPress={() => router.push(`${basePath}/quran/${surah.number}`)}
                accessibilityRole="button"
                accessibilityLabel={`${surah.number}. ${surah.englishName}`}
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
              >
                <View style={styles.number}>
                  <Text style={styles.numberText}>{surah.number}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {surah.englishName}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {surah.englishNameTranslation} ·{' '}
                    {t('quran.ayahCount', { count: surah.numberOfAyahs })}
                  </Text>
                </View>
                <Text style={styles.arabicName} numberOfLines={1}>
                  {surah.name}
                </Text>
              </Pressable>
            ))}
          </Card>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.xs, marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  number: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: brand.orange },
  rowText: { flex: 1 },
  rowTitle: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  // Deliberately larger: Arabic script at body size is hard to read, and this is
  // the name most readers of this screen will recognise first.
  arabicName: {
    fontSize: fontSize.lg,
    color: colors.text,
    writingDirection: 'rtl',
    maxWidth: 130,
  },
});
