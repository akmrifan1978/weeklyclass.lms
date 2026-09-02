import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { monthLabel, toISOMonth } from '@/utils/date';
import { listClasses } from '@/services/orgService';
import { listForClass, summarise, summariseByStudent } from '@/services/attendanceService';
import { listResults, summariseResults } from '@/services/quizService';
import { loadDashboardStats } from '@/services/statsService';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import {
  AsyncBoundary,
  Card,
  Grid,
  Screen,
  SectionHeader,
  Select,
  SkeletonList,
  Spacer,
  StatCard,
  type Option,
} from '@/components/ui';

/**
 * Combined reporting view: platform totals, attendance for a class-month, and
 * quiz performance. Everything is derived from bounded queries so the page cost
 * stays flat as the platform grows.
 */
function ReportsScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [classId, setClassId] = useState('');
  const [month, setMonth] = useState(toISOMonth());

  const loadClasses = useCallback(async () => {
    const page = await listClasses({ pageSize: 100 });
    return page.items;
  }, []);
  const { data: classes } = useAsync(loadClasses, []);

  const classOptions = useMemo<Option[]>(
    () => (classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  const monthOptions = useMemo<Option[]>(() => {
    const options: Option[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = toISOMonth(date);
      options.push({ value, label: monthLabel(value, language) });
    }
    return options;
  }, [language]);

  const load = useCallback(async () => {
    const stats = await loadDashboardStats();
    if (!classId) return { stats, attendance: null, byStudent: [], results: null };

    const [records, resultPage] = await Promise.all([
      listForClass({ classId, month }),
      listResults({ classId, pageSize: 100 }),
    ]);

    return {
      stats,
      attendance: summarise(records),
      byStudent: summariseByStudent(records),
      results: summariseResults(resultPage.items),
    };
  }, [classId, month]);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, [classId, month]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('nav.reports')}
      </Text>

      <Spacer />

      <AsyncBoundary loading={loading} error={error} onRetry={reload} skeleton={<SkeletonList count={4} />}>
        <SectionHeader title={t('dashboard.statistics')} icon="stats-chart-outline" />
        <Grid minItemWidth={150} gap={spacing.md}>
          <StatCard
            label={t('dashboard.totalStudents')}
            value={data?.stats.totalStudents ?? 0}
            icon="school-outline"
          />
          <StatCard
            label={t('dashboard.totalTeachers')}
            value={data?.stats.totalTeachers ?? 0}
            icon="people-outline"
            accent={colors.accent}
          />
          <StatCard
            label={t('dashboard.totalClasses')}
            value={data?.stats.totalClasses ?? 0}
            icon="library-outline"
            accent={colors.slate}
          />
          <StatCard
            label={t('dashboard.totalLessons')}
            value={data?.stats.totalLessons ?? 0}
            icon="book-outline"
          />
        </Grid>

        <Spacer size={spacing.xxl} />

        <SectionHeader title={t('attendance.title')} icon="checkbox-outline" />
        <Select
          label={t('auth.class')}
          value={classId}
          options={classOptions}
          onChange={setClassId}
          placeholder={t('attendance.selectClass')}
          allowClear
        />
        <Select
          label={t('attendance.monthly')}
          value={month}
          options={monthOptions}
          onChange={setMonth}
        />

        {data?.attendance ? (
          <>
            <Grid minItemWidth={140} gap={spacing.md}>
              <StatCard
                label={t('attendance.percentage')}
                value={`${data.attendance.percentage}%`}
                icon="pie-chart-outline"
                accent={
                  data.attendance.percentage >= 75
                    ? colors.success
                    : data.attendance.percentage >= 50
                      ? colors.warning
                      : colors.danger
                }
              />
              <StatCard
                label={t('attendance.present')}
                value={data.attendance.present}
                icon="checkmark-circle-outline"
                accent={colors.success}
              />
              <StatCard
                label={t('attendance.absent')}
                value={data.attendance.absent}
                icon="close-circle-outline"
                accent={colors.danger}
              />
              <StatCard
                label={t('attendance.totalClasses')}
                value={data.attendance.total}
                icon="calendar-outline"
              />
            </Grid>

            {data.byStudent.length ? (
              <>
                <Spacer />
                <Card>
                  {data.byStudent.map((row, index) => (
                    <View
                      key={row.studentId}
                      style={[styles.studentRow, index > 0 ? styles.bordered : null]}
                    >
                      <Text style={styles.studentName} numberOfLines={1}>
                        {row.studentName}
                      </Text>
                      <View style={styles.bar}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              width: `${Math.min(100, row.summary.percentage)}%`,
                              backgroundColor:
                                row.summary.percentage >= 75
                                  ? colors.success
                                  : row.summary.percentage >= 50
                                    ? colors.warning
                                    : colors.danger,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.percent}>{row.summary.percentage}%</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : (
          <Card>
            <Text style={styles.hint}>{t('attendance.selectClass')}</Text>
          </Card>
        )}

        {data?.results ? (
          <>
            <Spacer size={spacing.xxl} />
            <SectionHeader title={t('result.title')} icon="trophy-outline" />
            <Grid minItemWidth={140} gap={spacing.md}>
              <StatCard
                label={t('result.averageScore')}
                value={`${data.results.average}%`}
                icon="stats-chart-outline"
              />
              <StatCard
                label={t('result.bestScore')}
                value={`${data.results.best}%`}
                icon="trophy-outline"
                accent={colors.accent}
              />
              <StatCard
                label={t('result.passed')}
                value={`${data.results.passRate}%`}
                icon="checkmark-circle-outline"
                accent={colors.success}
              />
            </Grid>
          </>
        ) : null}

        <Spacer size={spacing.xxxl} />
      </AsyncBoundary>
    </Screen>
  );
}

export default function AdminReports() {
  return (
    <PermissionGuard permission="VIEW_RESULTS">
      <ReportsScreen />
    </PermissionGuard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingTop: spacing.sm,
  },
  hint: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  bordered: { borderTopWidth: 1, borderTopColor: colors.divider },
  studentName: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  bar: {
    flex: 1,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.pill },
  percent: {
    width: 48,
    textAlign: 'right',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
