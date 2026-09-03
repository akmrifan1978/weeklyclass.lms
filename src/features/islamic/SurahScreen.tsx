import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as quranService from '@/services/quranService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { AppHeader, Card, EmptyState, Screen, SkeletonList } from '@/components/ui';

/**
 * One surah: Arabic, with the translation for this dashboard's language.
 *
 * Changing the language here re-fetches the translation rather than the page —
 * the Arabic is the same text in every language, so only the second column
 * changes. Every surah read is cached, so coming back is instant and offline.
 */
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

  return (
    <>
      <AppHeader
        title={data?.englishName ?? t('nav.quran')}
        subtitle={data ? data.englishNameTranslation : undefined}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {loading ? (
          <SkeletonList count={6} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : data ? (
          <>
            <Card style={styles.header}>
              <Text style={styles.arabicTitle}>{data.name}</Text>
              <Text style={styles.meta}>
                {t('quran.ayahCount', { count: data.numberOfAyahs })} ·{' '}
                {data.revelationType === 'Meccan'
                  ? t('quran.meccan')
                  : t('quran.medinan')}
              </Text>
              {data.translationEdition ? null : (
                <Text style={styles.arabicOnlyNote}>{t('quran.arabicOnly')}</Text>
              )}
            </Card>

            {data.ayahs.map((ayah) => (
              <Card key={ayah.number} style={styles.ayah}>
                <View style={styles.ayahHeader}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{ayah.number}</Text>
                  </View>
                </View>

                <Text style={styles.arabic} accessibilityLanguage="ar">
                  {ayah.arabic}
                </Text>

                {ayah.translation ? (
                  <Text style={styles.translation}>{ayah.translation}</Text>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingVertical: spacing.xl, marginBottom: spacing.lg },
  arabicTitle: {
    fontSize: 30,
    color: colors.text,
    writingDirection: 'rtl',
    lineHeight: 48,
  },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  arabicOnlyNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  ayah: { marginBottom: spacing.md },
  ayahHeader: { flexDirection: 'row', marginBottom: spacing.sm },
  badge: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: brand.orange },
  // Arabic needs both a larger size and far more line height than Latin script:
  // the diacritics sit above and below the line and collide at normal spacing.
  arabic: {
    fontSize: 26,
    lineHeight: 52,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  translation: {
    fontSize: fontSize.sm,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
