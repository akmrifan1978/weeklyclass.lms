import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as prayerService from '@/services/prayerService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * Prayer (Salah) times.
 *
 * The dashboard keeps its own language, so someone can read prayer names in
 * Tamil while the rest of the app is in English — see useLanguageScope.
 *
 * The city has to come from somewhere. The profile carries a country but not a
 * city, so the city is asked for once and remembered; guessing it from the
 * country would be wrong for every country with more than one city in it.
 */

const PRAYER_LABELS: Record<prayerService.PrayerName, string> = {
  Fajr: 'prayer.fajr',
  Dhuhr: 'prayer.dhuhr',
  Asr: 'prayer.asr',
  Maghrib: 'prayer.maghrib',
  Isha: 'prayer.isha',
};

const CITY_STORAGE_KEY = '@weeklyclass/prayer-city';

export function PrayerTimesScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language, setLanguage } = useLanguageScope('prayer');

  const [city, setCity] = useState('');
  const [draft, setDraft] = useState('');
  const [cityLoaded, setCityLoaded] = useState(false);

  // Remembered per device rather than per account: which city you pray in is a
  // fact about where you are, not about who you are.
  useEffect(() => {
    let cancelled = false;
    import('@react-native-async-storage/async-storage')
      .then(({ default: storage }) => storage.getItem(CITY_STORAGE_KEY))
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          setCity(stored);
          setDraft(stored);
        }
        setCityLoaded(true);
      })
      .catch(() => !cancelled && setCityLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!city) return null;
    return prayerService.getPrayerTimes({ city, country: user?.country ?? '' });
  }, [city, user?.country]);

  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const upcoming = useMemo(() => (data ? prayerService.nextPrayer(data) : null), [data]);

  const saveCity = async () => {
    const next = draft.trim();
    if (!next) return;
    setCity(next);
    const { default: storage } = await import('@react-native-async-storage/async-storage');
    await storage.setItem(CITY_STORAGE_KEY, next).catch(() => undefined);
  };

  return (
    <>
      <AppHeader
        title={t('nav.prayer')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen refreshing={refreshing} onRefresh={city ? refresh : undefined}>
      <Card style={styles.cityCard}>
        <TextField
          label={t('prayer.city')}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={saveCity}
          returnKeyType="search"
          icon="location-outline"
          hint={user?.country ? t('prayer.cityHint', { country: user.country }) : undefined}
          containerStyle={{ marginBottom: spacing.md }}
        />
        <Button
          label={t('prayer.showTimes')}
          icon="time-outline"
          size="sm"
          onPress={saveCity}
          disabled={!draft.trim() || draft.trim() === city}
        />
      </Card>

      {!cityLoaded || (city && loading) ? (
        <SkeletonList count={5} />
      ) : !city ? (
        <EmptyState
          icon="location-outline"
          title={t('prayer.cityRequired')}
          message={t('prayer.cityRequiredHelp')}
        />
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
          <Card style={styles.hero}>
            <Text style={styles.heroCity}>{data.city}</Text>
            <Text style={styles.heroDate}>{data.readableDate}</Text>
            {data.hijri ? <Text style={styles.heroHijri}>{data.hijri}</Text> : null}

            {upcoming ? (
              <View style={styles.nextRow}>
                <Ionicons name="alarm-outline" size={18} color={brand.orange} />
                <Text style={styles.nextText}>
                  {t('prayer.nextIn', {
                    prayer: t(PRAYER_LABELS[upcoming.name]),
                    time: formatAway(upcoming.minutesAway, t),
                  })}
                </Text>
              </View>
            ) : (
              <View style={styles.nextRow}>
                <Ionicons name="moon-outline" size={18} color={brand.slate} />
                <Text style={styles.nextText}>{t('prayer.allDone')}</Text>
              </View>
            )}

            {data.cached ? (
              <Text style={styles.cachedNote}>{t('prayer.showingSaved')}</Text>
            ) : null}
          </Card>

          <SectionHeader title={t('prayer.today')} icon="time-outline" />
          <Card style={styles.list}>
            {data.timings.map((entry) => {
              const isNext = upcoming?.name === entry.name;
              return (
                <View
                  key={entry.name}
                  style={[styles.row, isNext ? styles.rowNext : null]}
                  accessibilityRole="text"
                  accessibilityLabel={`${t(PRAYER_LABELS[entry.name])} ${entry.time}`}
                >
                  <Text style={[styles.rowName, isNext ? styles.rowNameNext : null]}>
                    {t(PRAYER_LABELS[entry.name])}
                  </Text>
                  <Text style={[styles.rowTime, isNext ? styles.rowTimeNext : null]}>
                    {entry.time}
                  </Text>
                </View>
              );
            })}
            {data.sunrise ? (
              <View style={[styles.row, styles.rowMuted]}>
                <Text style={styles.rowNameMuted}>{t('prayer.sunrise')}</Text>
                <Text style={styles.rowTimeMuted}>{data.sunrise}</Text>
              </View>
            ) : null}
          </Card>
        </>
        ) : null}
      </Screen>
    </>
  );
}

function formatAway(
  minutes: number,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return t('prayer.minutes', { count: rest });
  if (rest === 0) return t('prayer.hours', { count: hours });
  return `${t('prayer.hours', { count: hours })} ${t('prayer.minutes', { count: rest })}`;
}

const styles = StyleSheet.create({
  cityCard: { marginBottom: spacing.lg },
  hero: { alignItems: 'center', paddingVertical: spacing.xl, marginBottom: spacing.lg },
  heroCity: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  heroDate: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  heroHijri: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  nextText: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  cachedNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
  list: { paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowNext: { backgroundColor: colors.accentSoft },
  rowMuted: { opacity: 0.7 },
  rowName: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  rowNameNext: { fontWeight: fontWeight.bold },
  rowNameMuted: { fontSize: fontSize.sm, color: colors.textMuted },
  rowTime: { fontSize: fontSize.md, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  rowTimeNext: { color: brand.orange, fontWeight: fontWeight.bold },
  rowTimeMuted: { fontSize: fontSize.sm, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
