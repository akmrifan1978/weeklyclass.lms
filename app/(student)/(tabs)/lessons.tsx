import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { spacing } from '@/constants/theme';
import { usePaginated } from '@/hooks/useAsync';
import { lessonsForStudent } from '@/services/contentService';
import { LessonRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Screen,
  SkeletonList,
} from '@/components/ui';
import type { Cursor } from '@/services/firestore';

export default function StudentLessons() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  const fetchPage = useCallback(
    (_cursor: Cursor) => lessonsForStudent(user?.classId ?? '', 20),
    [user?.classId]
  );

  const list = usePaginated(fetchPage, [user?.classId], { enabled: Boolean(user?.classId) });

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.lessons')} subtitle={t('dashboard.weeklyLessons')} />
      <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
        <AsyncBoundary
          loading={list.loading}
          error={list.error}
          empty={list.items.length === 0}
          onRetry={list.reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{
            icon: 'book-outline',
            title: t('lesson.noLessons'),
            message: user?.classId ? t('empty.checkBackSoon') : t('empty.notAssignedClass'),
          }}
        >
          <View style={{ gap: spacing.md }}>
            {list.items.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                onPress={() => router.push(`/(student)/lesson/${lesson.id}`)}
              />
            ))}
            {list.hasMore ? (
              <Button
                label={t('common.loadMore')}
                onPress={list.loadMore}
                loading={list.loadingMore}
                variant="outline"
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}
