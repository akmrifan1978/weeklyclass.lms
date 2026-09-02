import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, spacing } from '@/constants/theme';
import { useAsync, usePaginated } from '@/hooks/useAsync';
import { listClasses } from '@/services/orgService';
import { listQuizzes, listResults, summariseResults } from '@/services/quizService';
import { ResultRow } from '@/components/shared/ContentCards';
import type { Cursor } from '@/services/firestore';
import {
  AsyncBoundary,
  Button,
  Grid,
  Screen,
  SkeletonList,
  Select,
  Spacer,
  StatCard,
  type Option,
} from '@/components/ui';

/**
 * Results across a class or quiz, for admins and permitted teachers.
 * Students see their own results in the student area instead.
 */
export function ResultsManager({ classScope }: { classScope?: string[] }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [classId, setClassId] = useState('');
  const [quizId, setQuizId] = useState('');

  const loadRefs = useCallback(async () => {
    const classPage = await listClasses({ pageSize: 100 });
    const classes = classScope
      ? classPage.items.filter((c) => classScope.includes(c.id))
      : classPage.items;
    const quizPage = await listQuizzes({
      classId: classId || undefined,
      pageSize: 50,
    });
    const quizzes = classScope
      ? quizPage.items.filter((q) => classScope.includes(q.classId))
      : quizPage.items;
    return { classes, quizzes };
  }, [classScope, classId]);

  const { data: refs } = useAsync(loadRefs, [classScope?.join(','), classId]);

  const classOptions = useMemo<Option[]>(
    () => (refs?.classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [refs?.classes]
  );
  const quizOptions = useMemo<Option[]>(
    () => (refs?.quizzes ?? []).map((q) => ({ value: q.id, label: q.title })),
    [refs?.quizzes]
  );

  const fetchPage = useCallback(
    (cursor: Cursor) =>
      listResults({
        classId: classId || undefined,
        quizId: quizId || undefined,
        cursor,
        pageSize: 25,
      }),
    [classId, quizId]
  );

  const list = usePaginated(fetchPage, [classId, quizId]);
  const summary = summariseResults(list.items);

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh} edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('result.title')}
      </Text>

      <Spacer />

      <Select
        label={t('auth.class')}
        value={classId}
        options={classOptions}
        onChange={(value) => {
          setClassId(value);
          setQuizId('');
        }}
        placeholder={t('common.all')}
        allowClear
      />

      <Select
        label={t('quiz.title')}
        value={quizId}
        options={quizOptions}
        onChange={setQuizId}
        placeholder={t('common.all')}
        allowClear
      />

      <Grid minItemWidth={150} gap={spacing.md}>
        <StatCard
          label={t('result.averageScore')}
          value={`${summary.average}%`}
          icon="stats-chart-outline"
          accent={colors.primary}
        />
        <StatCard
          label={t('result.bestScore')}
          value={`${summary.best}%`}
          icon="trophy-outline"
          accent={colors.accent}
        />
        <StatCard
          label={t('result.passed')}
          value={`${summary.passRate}%`}
          icon="checkmark-circle-outline"
          accent={colors.success}
        />
        <StatCard
          label={t('common.showing', { count: summary.count, total: summary.count })}
          value={summary.count}
          icon="list-outline"
          accent={colors.slate}
        />
      </Grid>

      <Spacer />

      <AsyncBoundary
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        onRetry={list.reload}
        skeleton={<SkeletonList count={5} />}
        emptyProps={{ icon: 'trophy-outline', title: t('result.noResults') }}
      >
        <View style={{ gap: spacing.md }}>
          {list.items.map((result) => (
            <ResultRow key={result.id} result={result} locale={language} />
          ))}
          {list.hasMore ? (
            <Button
              label={t('common.loadMore')}
              onPress={list.loadMore}
              loading={list.loadingMore}
              variant="outline"
            />
          ) : null}
        </View>
      </AsyncBoundary>

      <Spacer size={spacing.xxxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text, paddingTop: spacing.sm },
});
