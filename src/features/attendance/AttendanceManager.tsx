import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import { monthLabel, toISODate, toISOMonth } from '@/utils/date';
import {
  listForClass,
  markAttendance,
  registerFor,
  summariseByStudent,
  type MarkEntry,
} from '@/services/attendanceService';
import { listClasses } from '@/services/orgService';
import { listStudentsOfClass } from '@/services/userService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import type { AttendanceStatus } from '@/types';
import {
  AsyncBoundary,
  Avatar,
  Button,
  Card,
  ChipGroup,
  DateField,
  Screen,
  SectionHeader,
  Select,
  SkeletonList,
  Spacer,
  type Option,
} from '@/components/ui';

const STATUSES: { value: AttendanceStatus; labelKey: string; color: string; soft: string }[] = [
  { value: 'present', labelKey: 'attendance.present', color: colors.success, soft: colors.successSoft },
  { value: 'late', labelKey: 'attendance.late', color: colors.warning, soft: colors.warningSoft },
  { value: 'absent', labelKey: 'attendance.absent', color: colors.danger, soft: colors.dangerSoft },
  { value: 'excused', labelKey: 'attendance.excused', color: colors.slate, soft: colors.infoSoft },
];

/**
 * Attendance register.
 *
 * Picking a class and a date loads the roster plus whatever was already
 * recorded, so re-opening the same day edits rather than duplicates. Saving is
 * one batched write — the whole class costs a single round trip.
 */
export function AttendanceManager({ classScope }: { classScope?: string[] }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();

  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(toISODate());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [mode, setMode] = useState<'register' | 'report'>('register');
  const [saving, setSaving] = useState(false);

  const canEdit = can('EDIT_ATTENDANCE');

  const loadClasses = useCallback(async () => {
    const page = await listClasses({ pageSize: 100 });
    return classScope ? page.items.filter((c) => classScope.includes(c.id)) : page.items;
  }, [classScope]);

  const { data: classes } = useAsync(loadClasses, [classScope?.join(',')]);

  // Default to the first class the user can act on.
  useEffect(() => {
    if (!classId && classes?.length) setClassId(classes[0]!.id);
  }, [classes, classId]);

  const classOptions = useMemo<Option[]>(
    () => (classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  const loadRegister = useCallback(async () => {
    if (!classId) return null;
    const [students, existing] = await Promise.all([
      listStudentsOfClass(classId).then((p) => p.items),
      registerFor(classId, date),
    ]);
    return { students, existing };
  }, [classId, date]);

  const {
    data: register,
    loading,
    error,
    reload,
    refreshing,
    refresh,
  } = useAsync(loadRegister, [classId, date], { enabled: Boolean(classId) });

  // Seed the form from what is already recorded; unrecorded students default to
  // present, which is the common case and the fastest to correct.
  useEffect(() => {
    if (!register) return;
    const seeded: Record<string, AttendanceStatus> = {};
    for (const student of register.students) seeded[student.uid] = 'present';
    for (const record of register.existing) seeded[record.studentId] = record.status;
    setMarks(seeded);
  }, [register]);

  const loadReport = useCallback(async () => {
    if (!classId) return [];
    const records = await listForClass({ classId, month: toISOMonth(new Date(date)) });
    return summariseByStudent(records);
  }, [classId, date]);

  const { data: report, loading: reportLoading } = useAsync(loadReport, [classId, date, mode], {
    enabled: mode === 'report' && Boolean(classId),
  });

  const handleSave = async () => {
    if (!user || !classId || !register) return;
    setSaving(true);
    try {
      const entries: MarkEntry[] = register.students.map((student) => ({
        studentId: student.uid,
        studentName: student.fullName,
        status: marks[student.uid] ?? 'present',
      }));
      await markAttendance(
        {
          classId,
          branchId: classes?.find((c) => c.id === classId)?.branchId ?? null,
          date,
          entries,
        },
        user
      );
      logEvent(AnalyticsEvents.attendanceMarked, { classId, count: entries.length });
      toast.success(t('attendance.attendanceSaved'));
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const markAll = (status: AttendanceStatus) => {
    if (!register) return;
    const next: Record<string, AttendanceStatus> = {};
    for (const student of register.students) next[student.uid] = status;
    setMarks(next);
  };

  const counts = useMemo(() => {
    const tally: Record<AttendanceStatus, number> = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const status of Object.values(marks)) tally[status] += 1;
    return tally;
  }, [marks]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('attendance.title')}
      </Text>

      <Spacer />

      <Select
        label={t('attendance.selectClass')}
        value={classId}
        options={classOptions}
        onChange={setClassId}
        placeholder={t('attendance.selectClass')}
      />

      <DateField label={t('attendance.selectDate')} value={date} onChange={setDate} />

      <ChipGroup<'register' | 'report'>
        options={[
          { value: 'register', label: t('attendance.markAttendance') },
          { value: 'report', label: t('attendance.monthly') },
        ]}
        value={mode}
        onChange={setMode}
      />

      <Spacer />

      {!classId ? (
        <Card>
          <Text style={styles.hint}>{t('attendance.selectClass')}</Text>
        </Card>
      ) : mode === 'register' ? (
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={(register?.students ?? []).length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{ icon: 'people-outline', title: t('common.noResults') }}
        >
          <Card style={styles.tallyCard}>
            <View style={styles.tallyRow}>
              {STATUSES.map((status) => (
                <View key={status.value} style={styles.tallyItem}>
                  <Text style={[styles.tallyValue, { color: status.color }]}>
                    {counts[status.value]}
                  </Text>
                  <Text style={styles.tallyLabel}>{t(status.labelKey)}</Text>
                </View>
              ))}
            </View>
            {canEdit ? (
              <Button
                label={t('attendance.markAllPresent')}
                icon="checkmark-done-outline"
                variant="outline"
                size="sm"
                onPress={() => markAll('present')}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Card>

          <Spacer />

          <View style={{ gap: spacing.md }}>
            {(register?.students ?? []).map((student) => (
              <Card key={student.uid}>
                <View style={styles.studentRow}>
                  <Avatar name={student.fullName} uri={student.profileImage} size={38} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {student.fullName}
                    </Text>
                    <Text style={styles.studentId}>{student.studentId}</Text>
                  </View>
                </View>

                <View style={styles.statusRow}>
                  {STATUSES.map((status) => {
                    const active = marks[student.uid] === status.value;
                    return (
                      <Pressable
                        key={status.value}
                        disabled={!canEdit}
                        onPress={() =>
                          setMarks((previous) => ({ ...previous, [student.uid]: status.value }))
                        }
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active, disabled: !canEdit }}
                        accessibilityLabel={`${student.fullName}: ${t(status.labelKey)}`}
                        style={[
                          styles.statusChip,
                          active
                            ? { backgroundColor: status.soft, borderColor: status.color }
                            : null,
                          !canEdit ? { opacity: 0.6 } : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            active ? { color: status.color, fontWeight: fontWeight.bold } : null,
                          ]}
                        >
                          {t(status.labelKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            ))}
          </View>

          {canEdit && (register?.students ?? []).length > 0 ? (
            <>
              <Spacer />
              <Button
                label={t('attendance.saveAttendance')}
                icon="save-outline"
                fullWidth
                size="lg"
                loading={saving}
                onPress={handleSave}
              />
            </>
          ) : null}
        </AsyncBoundary>
      ) : (
        <>
          <SectionHeader
            title={monthLabel(toISOMonth(new Date(date)), language)}
            icon="stats-chart-outline"
          />
          <AsyncBoundary
            loading={reportLoading}
            empty={(report ?? []).length === 0}
            skeleton={<SkeletonList count={4} />}
            emptyProps={{ icon: 'bar-chart-outline', title: t('attendance.noRecords') }}
          >
            <View style={{ gap: spacing.md }}>
              {(report ?? []).map((row) => (
                <Card key={row.studentId}>
                  <View style={styles.reportRow}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {row.studentName}
                    </Text>
                    <Text
                      style={[
                        styles.reportPercent,
                        {
                          color:
                            row.summary.percentage >= 75
                              ? colors.success
                              : row.summary.percentage >= 50
                                ? colors.warning
                                : colors.danger,
                        },
                      ]}
                    >
                      {row.summary.percentage}%
                    </Text>
                  </View>
                  <Text style={styles.reportMeta}>
                    {t('attendance.present')}: {row.summary.present} · {t('attendance.late')}:{' '}
                    {row.summary.late} · {t('attendance.absent')}: {row.summary.absent} ·{' '}
                    {t('attendance.excused')}: {row.summary.excused}
                  </Text>
                </Card>
              ))}
            </View>
          </AsyncBoundary>
        </>
      )}

      <Spacer size={spacing.xxxl} />
    </Screen>
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
  tallyCard: { paddingVertical: spacing.lg },
  tallyRow: { flexDirection: 'row' },
  tallyItem: { flex: 1, alignItems: 'center' },
  tallyValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  tallyLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  studentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  studentName: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  studentId: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  statusChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  statusText: { fontSize: fontSize.xs, color: colors.textSecondary },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  reportPercent: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  reportMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
});
