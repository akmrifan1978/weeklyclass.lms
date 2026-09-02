import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useTeacherScope } from '@/hooks/useTeacherScope';
import { matchesSearch } from '@/utils/format';
import { listStudentsOfClass } from '@/services/userService';
import { listForClass, summariseByStudent } from '@/services/attendanceService';
import { useAuth } from '@/contexts/AuthContext';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import {
  AppHeader,
  AsyncBoundary,
  Avatar,
  Card,
  DetailRow,
  Divider,
  FormSheet,
  Screen,
  SearchField,
  Select,
  SkeletonList,
  Spacer,
  StatusBadge,
  type Option,
} from '@/components/ui';
import type { AppUser } from '@/types';

/**
 * The students in a teacher's own classes.
 *
 * Read-only by design: a teacher edits a student record only if an admin has
 * granted EDIT_STUDENTS, which is handled in the admin user manager.
 */
function TeacherStudentsScreen() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const params = useLocalSearchParams<{ classId?: string }>();
  const { classes, loading: scopeLoading } = useTeacherScope();

  const [classId, setClassId] = useState(params.classId ?? '');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<AppUser | null>(null);

  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0]!.id);
  }, [classes, classId]);

  const classOptions = useMemo<Option[]>(
    () => classes.map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  const load = useCallback(async () => {
    if (!classId) return { students: [], attendance: [] };
    const [studentPage, records] = await Promise.all([
      listStudentsOfClass(classId),
      can('VIEW_ATTENDANCE')
        ? listForClass({ classId, pageSize: 300 }).catch(() => [])
        : Promise.resolve([]),
    ]);
    return { students: studentPage.items, attendance: summariseByStudent(records) };
  }, [classId, can]);

  const { data, loading, error, reload, refreshing, refresh } = useAsync(load, [classId], {
    enabled: Boolean(classId),
  });

  const visible = useMemo(
    () =>
      (data?.students ?? []).filter((student) =>
        matchesSearch(term, student.fullName, student.studentId, student.username, student.email)
      ),
    [data?.students, term]
  );

  const attendanceFor = (uid: string) =>
    (data?.attendance ?? []).find((row) => row.studentId === uid)?.summary ?? null;

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.myStudents')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Select
          label={t('auth.class')}
          value={classId}
          options={classOptions}
          onChange={setClassId}
          placeholder={t('attendance.selectClass')}
        />

        <SearchField value={term} onChangeText={setTerm} />

        <Spacer />

        <AsyncBoundary
          loading={loading || scopeLoading}
          error={error}
          empty={visible.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{
            icon: 'people-outline',
            title: t('common.noResults'),
            message: classes.length === 0 ? t('empty.notAssignedClass') : undefined,
          }}
        >
          <View style={{ gap: spacing.md }}>
            {visible.map((student) => {
              const summary = attendanceFor(student.uid);
              return (
                <Card
                  key={student.id}
                  onPress={() => setSelected(student)}
                  accessibilityLabel={student.fullName}
                >
                  <View style={styles.row}>
                    <Avatar name={student.fullName} uri={student.profileImage} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {student.fullName}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {student.studentId} · @{student.username}
                      </Text>
                      {summary ? (
                        <Text style={styles.meta}>
                          {t('attendance.percentage')}: {summary.percentage}%
                        </Text>
                      ) : null}
                    </View>
                    <StatusBadge status={student.status} />
                  </View>
                </Card>
              );
            })}
          </View>
        </AsyncBoundary>

        <Spacer size={spacing.xxxl} />
      </Screen>

      <FormSheet
        visible={Boolean(selected)}
        title={selected?.fullName ?? ''}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <View style={styles.detailHeader}>
              <Avatar name={selected.fullName} uri={selected.profileImage} size={72} />
              <Text style={styles.detailName}>{selected.fullName}</Text>
              <StatusBadge status={selected.status} />
            </View>

            <Card>
              <DetailRow
                label={t('auth.studentId')}
                value={selected.studentId}
                icon="card-outline"
              />
              <Divider />
              <DetailRow label={t('auth.email')} value={selected.email} icon="mail-outline" />
              <Divider />
              <DetailRow label={t('auth.mobile')} value={selected.mobile} icon="call-outline" />
              <Divider />
              <DetailRow label={t('auth.country')} value={selected.country} icon="globe-outline" />
              {attendanceFor(selected.uid) ? (
                <>
                  <Divider />
                  <DetailRow
                    label={t('attendance.percentage')}
                    value={`${attendanceFor(selected.uid)!.percentage}%`}
                    icon="checkbox-outline"
                  />
                </>
              ) : null}
            </Card>
          </>
        ) : null}
      </FormSheet>
    </View>
  );
}

export default function TeacherStudents() {
  return (
    <PermissionGuard permission="VIEW_STUDENTS">
      <TeacherStudentsScreen />
    </PermissionGuard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  detailHeader: { alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  detailName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
});
