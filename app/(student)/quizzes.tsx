import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { availableForStudent } from '@/services/quizService';
import { QuizRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  Screen,
  SkeletonList,
} from '@/components/ui';

export default function StudentQuizzes() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    if (!user?.classId) return [];
    return availableForStudent(user.classId, user.uid);
  }, [user?.classId, user?.uid]);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, [
    user?.classId,
    user?.uid,
  ]);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('quiz.title')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={(data ?? []).length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={4} />}
          emptyProps={{
            icon: 'help-circle-outline',
            title: t('quiz.noQuizzes'),
            message: user?.classId ? t('empty.checkBackSoon') : t('empty.notAssignedClass'),
          }}
        >
          <View style={{ gap: spacing.md }}>
            {(data ?? []).map(({ quiz, attemptsUsed, lastResultId }) => {
              const exhausted = quiz.maxAttempts > 0 && attemptsUsed >= quiz.maxAttempts;
              return (
                <QuizRow
                  key={quiz.id}
                  quiz={quiz}
                  attemptsUsed={attemptsUsed}
                  onPress={() => {
                    if (exhausted) {
                      if (lastResultId) router.push(`/(student)/result/${lastResultId}`);
                      else toast.show(t('quiz.noAttemptsLeft'));
                      return;
                    }
                    router.push(`/(student)/quiz/${quiz.id}`);
                  }}
                />
              );
            })}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}
