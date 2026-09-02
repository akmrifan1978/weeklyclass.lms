import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { colors, fontSize, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useTeacherScope } from '@/hooks/useTeacherScope';
import { listBranches } from '@/services/orgService';
import { AdminRow } from '@/features/AdminRow';
import {
  AppHeader,
  AsyncBoundary,
  Card,
  Screen,
  SkeletonList,
  Spacer,
} from '@/components/ui';

export default function TeacherClasses() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const router = useRouter();
  const { classes, loading, error, reload } = useTeacherScope();

  const loadBranches = useCallback(() => listBranches().catch(() => []), []);
  const { data: branches } = useAsync(loadBranches, []);

  const branchName = (id: string) => (branches ?? []).find((b) => b.id === id)?.name ?? '';

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.myClasses')} />

      <Screen>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={classes.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={4} />}
          emptyProps={{
            icon: 'library-outline',
            title: t('empty.nothingHere'),
            message: t('empty.notAssignedClass'),
          }}
        >
          <View style={{ gap: spacing.md }}>
            {classes.map((klass) => (
              <AdminRow
                key={klass.id}
                icon="library-outline"
                title={klass.name}
                subtitle={klass.description || undefined}
                meta={[branchName(klass.branchId), klass.schedule].filter(Boolean).join(' · ')}
                badges={[
                  { label: t(`common.${klass.status}`), tone: klass.status },
                  ...(klass.code ? [{ label: klass.code }] : []),
                ]}
                onPress={
                  can('VIEW_STUDENTS')
                    ? () =>
                        router.push({
                          pathname: '/(teacher)/students',
                          params: { classId: klass.id },
                        })
                    : undefined
                }
              />
            ))}
          </View>

          <Spacer />

          <Card>
            <Text style={styles.note}>{t('admin.permissionsAdminNote')}</Text>
          </Card>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
});
