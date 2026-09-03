import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { loadUserProgress } from '@/services/progressService';
import {
  AppHeader,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';

/**
 * A student's own progress.
 *
 * Deliberately encouraging rather than exhaustive: attendance, assignments and
 * the Qur'an plan, which are the three things someone actually wants to know
 * about themselves. A wall of every metric the app could compute would tell them
 * less, not more.
 *
 * Nothing here is a grade or a judgement. It is a mirror.
 */
export function MyProgressScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();

  const load = useCallback(
    () => (user ? loadUserProgress(user) : Promise.resolve(null)),
    [user?.uid, user?.classId]
  );
  const { data, loading, refreshing, refresh } = useAsync(load, [load]);

  return (
    <>
      <AppHeader title={t('nav.myProgress')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {loading ? (
          <SkeletonList count={4} />
        ) : !data ? (
          <EmptyState icon="stats-chart-outline" title={t('progress.none')} />
        ) : (
          <>
            <SectionHeader title={t('nav.attendance')} icon="checkbox-outline" />
            <Card style={styles.card}>
              <Ring
                percent={data.attendance.percent}
                caption={t('progress.attendanceOf', {
                  present: data.attendance.present,
                  total: data.attendance.total,
                })}
                tint={brand.navy}
              />
              {data.attendance.total === 0 ? (
                <Text style={styles.emptyNote}>{t('progress.noAttendanceYet')}</Text>
              ) : null}
            </Card>

            <SectionHeader title={t('nav.quizzes')} icon="help-circle-outline" />
            <Card style={styles.statsCard}>
              <Stat
                value={String(data.assignments.submitted)}
                label={t('progress.submitted')}
              />
              <Stat
                value={String(data.assignments.available)}
                label={t('progress.available')}
              />
              <Stat
                value={
                  data.assignments.averageScore === null
                    ? '—'
                    : `${data.assignments.averageScore}%`
                }
                label={t('progress.averageScore')}
              />
            </Card>

            <SectionHeader title={t('nav.lessons')} icon="book-outline" />
            <Card style={styles.statsCard}>
              <Stat
                value={String(data.lessons.available)}
                label={t('progress.lessonsAvailable')}
              />
            </Card>

            <SectionHeader title={t('quran.dailyReading')} icon="bookmarks-outline" />
            {data.quran ? (
              <Card style={styles.card}>
                <Ring
                  percent={data.quran.percent}
                  caption={t('progress.pagesOf', {
                    read: data.quran.pagesRead,
                    total: data.quran.pagesTotal,
                  })}
                  tint={brand.orange}
                />
                {data.quran.streak > 1 ? (
                  <View style={styles.streak}>
                    <Ionicons name="flame" size={15} color={brand.orange} />
                    <Text style={styles.streakText}>
                      {t('quran.streak', { count: data.quran.streak })}
                    </Text>
                  </View>
                ) : null}
              </Card>
            ) : (
              <EmptyState
                icon="bookmarks-outline"
                title={t('progress.noPlan')}
                message={t('progress.noPlanHelp')}
                actionLabel={t('quran.createPlan')}
                onAction={() => router.push('/(student)/quran/plan')}
              />
            )}
          </>
        )}
      </Screen>
    </>
  );
}

/**
 * A percentage as a bar rather than a real ring — a circular progress arc needs
 * SVG, and a bar reads just as clearly at this size for a fraction of the code.
 */
function Ring({
  percent,
  caption,
  tint,
}: {
  percent: number;
  caption: string;
  tint: string;
}) {
  return (
    <View>
      <View style={styles.percentRow}>
        <Text style={[styles.percent, { color: tint }]}>{percent}%</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      <View
        style={styles.bar}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: percent, min: 0, max: 100 }}
      >
        <View
          style={[styles.barFill, { width: `${Math.min(100, percent)}%`, backgroundColor: tint }]}
        />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  statsCard: { flexDirection: 'row', marginBottom: spacing.lg },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  percentRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  percent: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  caption: { flex: 1, fontSize: fontSize.xs, color: colors.textMuted },
  bar: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.pill },
  emptyNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  streakText: { fontSize: fontSize.xs, color: colors.text, fontWeight: fontWeight.semibold },
});
