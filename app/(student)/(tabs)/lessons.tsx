import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { spacing } from '@/constants/theme';
import { useLive } from '@/hooks/useLive';
import { watchLessonsForStudent } from '@/services/contentService';
import type { Lesson } from '@/types';
import { LessonRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Screen,
  SkeletonList,
} from '@/components/ui';

export default function StudentLessons() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  /*
   * Live, and no longer paged.
   *
   * A lesson a teacher publishes now reaches the class without anybody pulling
   * to refresh, which is what a student would expect of a screen called
   * Lessons. The "load more" button goes with it: a weekly class produces
   * fifty-odd lessons a year, so sixty covers more than the whole course and
   * paging through them was buying nothing.
   */
  const subscribe = useCallback(
    (onNext: (items: Lesson[]) => void, onError: (error: unknown) => void) =>
      watchLessonsForStudent(user?.classId ?? '', onNext, onError, 60),
    [user?.classId]
  );

  const list = useLive(subscribe, [user?.classId], { enabled: Boolean(user?.classId) });
  const lessons = list.data ?? [];

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.lessons')} subtitle={t('dashboard.weeklyLessons')} />
      <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
        <AsyncBoundary
          loading={list.loading}
          error={list.error}
          empty={lessons.length === 0}
          onRetry={list.reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{
            icon: 'book-outline',
            title: t('lesson.noLessons'),
            message: user?.classId ? t('empty.checkBackSoon') : t('empty.notAssignedClass'),
          }}
        >
          <View style={{ gap: spacing.md }}>
            {lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                onPress={() => router.push(`/(student)/lesson/${lesson.id}`)}
              />
            ))}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}
