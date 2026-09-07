import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import * as translateService from '@/services/translateService';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import type { LanguageCode } from '@/types';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime } from '@/utils/date';
import {
  getQuiz,
  getResult,
  listQuestions,
  listQuestionsWithAnswers,
} from '@/services/quizService';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Card,
  DetailRow,
  Divider,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
} from '@/components/ui';
import type { QuizAttempt } from '@/types';
import { getById } from '@/services/firestore';
import { COLLECTIONS } from '@/constants/app';

/**
 * Result screen with answer review.
 *
 * The answer key is readable here because the student has a submitted attempt —
 * that is exactly the condition the security rules check.
 */
export default function ResultDetail() {
  const { t } = useTranslation();
  const { language } = useLanguage();

  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(async () => {
    if (!id) return null;
    const result = await getResult(id);
    if (!result) return null;

    const [attempt, questions, quiz] = await Promise.all([
      getById<QuizAttempt>(COLLECTIONS.quizAttempts, result.attemptId),
      // Falls back to questions without the key if the rules deny it, so the
      // score is still shown even when review is unavailable.
      listQuestionsWithAnswers(result.quizId).catch(() =>
        listQuestions(result.quizId).then((rows) =>
          rows.map((row) => ({ ...row, correctIndex: -1 }))
        )
      ),
      // Only for its language. A failure here costs the translate button and
      // nothing else, so it must not take the results page down with it.
      getQuiz(result.quizId).catch(() => null),
    ]);

    return { result, attempt, questions, quizLanguage: quiz?.language ?? null };
  }, [id]);

  const { data, loading, error, reload } = useAsync(load, [id]);
  const result = data?.result;
  const passed = result?.passed ?? false;

  const [glosses, setGlosses] = useState<
    Record<string, { text?: string; loading?: boolean }>
  >({});

  /**
   * The language the assignment was written in.
   *
   * Fetched with the result rather than assumed: translating Tamil questions
   * "from English" produces confident nonsense, and the reader has no way to
   * tell that is what happened.
   */
  const sourceLanguage = (data?.quizLanguage ?? 'en') as LanguageCode;
  const canTranslate = sourceLanguage !== language;

  const translateQuestion = async (question: {
    id?: string;
    text: string;
    options: string[];
  }) => {
    const key = question.id;
    if (!key) return;
    setGlosses((g) => ({ ...g, [key]: { loading: true } }));
    try {
      const source = [question.text, ...question.options].join('. ');
      const text = await translateService.translate(
        source,
        sourceLanguage,
        language as LanguageCode
      );
      setGlosses((g) => ({ ...g, [key]: { text } }));
    } catch {
      // Silent: the original is on screen and readable, and an error message
      // where a convenience should be only adds noise to a results page.
      setGlosses((g) => ({ ...g, [key]: {} }));
    }
  };


  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('result.title')} subtitle={result?.quizTitle} showBack />

      <Screen>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={!result}
          onRetry={reload}
          skeleton={<SkeletonList count={3} />}
          emptyProps={{ icon: 'trophy-outline', title: t('result.noResults') }}
        >
          {result ? (
            <>
              <Card style={styles.scoreCard}>
                <View
                  style={[
                    styles.scoreCircle,
                    { borderColor: passed ? colors.success : colors.danger },
                  ]}
                >
                  <Text
                    style={[styles.scoreGrade, { color: passed ? colors.success : colors.danger }]}
                  >
                    {result.grade}
                  </Text>
                  <Text style={styles.scorePercent}>{result.percentage}%</Text>
                </View>

                <Text
                  style={[styles.verdict, { color: passed ? colors.success : colors.danger }]}
                >
                  {t(passed ? 'result.passed' : 'result.failed')}
                </Text>
                <Text style={styles.scoreLine}>
                  {result.score} / {result.totalMarks} {t('quiz.marks')}
                </Text>

                <View style={styles.breakdown}>
                  <Stat
                    icon="checkmark-circle"
                    label={t('result.correct')}
                    value={result.correctCount}
                    color={colors.success}
                  />
                  <Stat
                    icon="close-circle"
                    label={t('result.wrong')}
                    value={result.wrongCount}
                    color={colors.danger}
                  />
                  <Stat
                    icon="remove-circle"
                    label={t('result.unanswered')}
                    value={result.unansweredCount}
                    color={colors.textMuted}
                  />
                </View>
              </Card>

              <Spacer />

              <Card>
                <DetailRow
                  label={t('result.completedOn')}
                  value={formatDateTime(result.completedAt, language)}
                  icon="calendar-outline"
                />
                <Divider />
                <DetailRow label={t('quiz.title')} value={result.quizTitle} icon="help-circle-outline" />
              </Card>

              {data?.questions.some((q) => q.correctIndex >= 0) ? (
                <>
                  <Spacer />
                  <SectionHeader title={t('result.reviewAnswers')} icon="list-outline" />
                  <View style={{ gap: spacing.md }}>
                    {data.questions.map((question, index) => {
                      const given = question.id ? data.attempt?.answers?.[question.id] : undefined;
                      const correct = given === question.correctIndex;
                      return (
                        <Card key={question.id ?? index}>
                          <View style={styles.reviewHeader}>
                            <Ionicons
                              name={
                                given === undefined
                                  ? 'remove-circle-outline'
                                  : correct
                                    ? 'checkmark-circle'
                                    : 'close-circle'
                              }
                              size={19}
                              color={
                                given === undefined
                                  ? colors.textMuted
                                  : correct
                                    ? colors.success
                                    : colors.danger
                              }
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.reviewQuestion}>
                                {index + 1}. {question.text}
                              </Text>
                              {/* The same rough reading offered while sitting
                                  the assignment. Reviewing what you got wrong
                                  in a language you cannot read teaches nobody
                                  anything, which is the entire point of a
                                  review screen. */}
                              {question.id && glosses[question.id]?.text ? (
                                <Text style={styles.reviewGloss}>
                                  {glosses[question.id!]?.text}
                                </Text>
                              ) : question.id && glosses[question.id]?.loading ? (
                                <Text style={styles.reviewGlossNote}>
                                  {t('scripture.translating')}
                                </Text>
                              ) : canTranslate && question.id ? (
                                <Text
                                  onPress={() => void translateQuestion(question)}
                                  accessibilityRole="button"
                                  style={styles.reviewGlossLink}
                                >
                                  {t('quiz.translateQuestion')}
                                </Text>
                              ) : null}
                            </View>
                          </View>

                          <View style={styles.reviewAnswers}>
                            {question.options.map((option, optionIndex) => {
                              const isCorrect = optionIndex === question.correctIndex;
                              const isGiven = optionIndex === given;
                              return (
                                <View
                                  key={optionIndex}
                                  style={[
                                    styles.reviewOption,
                                    isCorrect ? styles.reviewOptionCorrect : null,
                                    isGiven && !isCorrect ? styles.reviewOptionWrong : null,
                                  ]}
                                >
                                  <Text style={styles.reviewOptionText}>
                                    {String.fromCharCode(65 + optionIndex)}. {option}
                                  </Text>
                                  {isCorrect ? (
                                    <Text style={styles.reviewTag}>{t('result.correctAnswer')}</Text>
                                  ) : isGiven ? (
                                    <Text style={[styles.reviewTag, styles.reviewTagWrong]}>
                                      {t('result.yourAnswer')}
                                    </Text>
                                  ) : null}
                                </View>
                              );
                            })}
                          </View>

                          {question.explanation ? (
                            <Text style={styles.explanation}>{question.explanation}</Text>
                          ) : null}
                        </Card>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Spacer />
              <Button
                label={t('result.myResults')}
                icon="trophy-outline"
                variant="outline"
                fullWidth
                onPress={() => router.replace('/(student)/results')}
              />
              <Spacer size={spacing.xxxl} />
            </>
          ) : null}
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={19} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  reviewGloss: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: 6,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  reviewGlossNote: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  reviewGlossLink: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
    marginTop: 6,
  },
  scoreCard: { alignItems: 'center', paddingVertical: spacing.xxl },
  scoreCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreGrade: { fontSize: 40, fontWeight: fontWeight.heavy },
  scorePercent: { fontSize: fontSize.md, color: colors.textSecondary, marginTop: 2 },
  verdict: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.lg },
  scoreLine: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  breakdown: { flexDirection: 'row', marginTop: spacing.xl, width: '100%' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  reviewHeader: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  reviewQuestion: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: fontWeight.medium,
    lineHeight: 21,
  },
  reviewAnswers: { gap: spacing.sm, marginTop: spacing.md },
  reviewOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reviewOptionCorrect: { backgroundColor: colors.successSoft },
  reviewOptionWrong: { backgroundColor: colors.dangerSoft },
  reviewOptionText: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  reviewTag: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.success,
    textTransform: 'uppercase',
  },
  reviewTagWrong: { color: colors.danger },
  explanation: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.md,
    lineHeight: 19,
  },
});
