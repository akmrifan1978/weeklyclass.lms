import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { colors, spacing } from '@/constants/theme';
import { usePaginated } from '@/hooks/useAsync';
import { listResults, summariseResults } from '@/services/quizService';
import { ResultRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Grid,
  Screen,
  SkeletonList,
  Spacer,
  StatCard,
} from '@/components/ui';
import type { Cursor } from '@/services/firestore';

export default function StudentResults() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();

  const fetchPage = useCallback(
    (cursor: Cursor) => listResults({ studentId: user?.uid, cursor, pageSize: 20 }),
    [user?.uid]
  );

  const list = usePaginated(fetchPage, [user?.uid], { enabled: Boolean(user?.uid) });
  const summary = summariseResults(list.items);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('result.myResults')} showBack />

      <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
        <AsyncBoundary
          loading={list.loading}
          error={list.error}
          empty={list.items.length === 0}
          onRetry={list.reload}
          skeleton={<SkeletonList count={4} />}
          emptyProps={{ icon: 'trophy-outline', title: t('result.noResults') }}
        >
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
          </Grid>

          <Spacer />

          <View style={{ gap: spacing.md }}>
            {list.items.map((result) => (
              <ResultRow
                key={result.id}
                result={result}
                locale={language}
                onPress={() => router.push(`/(student)/result/${result.id}`)}
              />
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
      </Screen>
    </View>
  );
}
