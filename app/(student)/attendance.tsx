import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatShortDate, monthLabel } from '@/utils/date';
import { listForStudent, summarise, summariseByMonth } from '@/services/attendanceService';
import { AttendanceSummaryCard } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  Badge,
  Card,
  ChipGroup,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
} from '@/components/ui';
import { GuestGate } from '@/components/shared/GuestGate';

type View_ = 'overall' | 'monthly';

function StudentAttendanceInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const [mode, setMode] = useState<View_>('overall');

  const load = useCallback(async () => {
    if (!user) return [];
    const page = await listForStudent({ studentId: user.uid, pageSize: 200 });
    return page.items;
  }, [user?.uid]);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, [user?.uid]);

  const records = data ?? [];
  const overall = summarise(records);
  const byMonth = summariseByMonth(records);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('attendance.title')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={records.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={3} />}
          emptyProps={{ icon: 'checkbox-outline', title: t('attendance.noRecords') }}
        >
          <AttendanceSummaryCard summary={overall} />

          <Spacer />

          <ChipGroup<View_>
            options={[
              { value: 'overall', label: t('attendance.overall') },
              { value: 'monthly', label: t('attendance.monthly') },
            ]}
            value={mode}
            onChange={setMode}
          />

          <Spacer size={spacing.md} />

          {mode === 'monthly' ? (
            <View style={{ gap: spacing.md }}>
              {byMonth.map(({ month, summary }) => (
                <Card key={month}>
                  <View style={styles.monthRow}>
                    <Text style={styles.monthName}>{monthLabel(month, language)}</Text>
                    <Text
                      style={[
                        styles.monthPercent,
                        {
                          color:
                            summary.percentage >= 75
                              ? colors.success
                              : summary.percentage >= 50
                                ? colors.warning
                                : colors.danger,
                        },
                      ]}
                    >
                      {summary.percentage}%
                    </Text>
                  </View>
                  <Text style={styles.monthMeta}>
                    {t('attendance.totalClasses')}: {summary.total} · {t('attendance.present')}:{' '}
                    {summary.present} · {t('attendance.absent')}: {summary.absent}
                  </Text>
                </Card>
              ))}
            </View>
          ) : (
            <>
              <SectionHeader title={t('attendance.title')} icon="list-outline" />
              <View style={{ gap: spacing.sm }}>
                {records.map((record) => (
                  <Card key={record.id}>
                    <View style={styles.recordRow}>
                      <View style={styles.recordDate}>
                        <Text style={styles.recordDateText}>
                          {formatShortDate(record.date, language)}
                        </Text>
                        {record.note ? (
                          <Text style={styles.recordNote} numberOfLines={1}>
                            {record.note}
                          </Text>
                        ) : null}
                      </View>
                      <Badge label={t(`attendance.${record.status}`)} tone={record.status} />
                    </View>
                  </Card>
                ))}
              </View>
            </>
          )}

          <Spacer size={spacing.xxxl} />
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  monthName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  monthPercent: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  monthMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recordDate: { flex: 1 },
  recordDateText: { fontSize: fontSize.md, color: colors.text },
  recordNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function StudentAttendance() {
  return (
    <GuestGate messageKey="guestMode.personal" titleKey="nav.attendance">
      <StudentAttendanceInner />
    </GuestGate>
  );
}
