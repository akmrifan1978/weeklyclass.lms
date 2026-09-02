import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatCountdown, toDate } from '@/utils/date';
import { friendlyMessage } from '@/utils/errors';
import { saveProgress, startAttempt, submitAttempt } from '@/services/quizService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Card,
  ConfirmDialog,
  Screen,
  SkeletonList,
  Spacer,
} from '@/components/ui';

/**
 * Quiz player.
 *
 * Answers are written back to the attempt as the student moves between
 * questions, so a dropped connection or a closed app does not lose progress.
 * When the timer runs out the attempt submits itself.
 */
export default function QuizPlayer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const load = useCallback(async () => {
    if (!id || !user) return null;
    const session = await startAttempt(id, user);
    logEvent(AnalyticsEvents.quizStarted, { quizId: id });
    return session;
  }, [id, user]);

  const { data, loading, error, reload } = useAsync(load, [id, user?.uid]);

  // Restore answers already saved on a resumed attempt.
  useEffect(() => {
    if (data?.attempt.answers) setAnswers(data.attempt.answers);
  }, [data?.attempt.id]);

  const handleSubmit = useCallback(
    async (auto = false) => {
      if (!data || !user || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        await submitAttempt(data.attempt.id, answers, user);
        logEvent(AnalyticsEvents.quizSubmitted, { quizId: data.quiz.id });
        if (auto) toast.show(t('quiz.timeUp'));
        router.replace(`/(student)/result/${data.attempt.id}`);
      } catch (err) {
        submittedRef.current = false;
        toast.error(friendlyMessage(err, t));
      } finally {
        setSubmitting(false);
        setConfirming(false);
      }
    },
    [answers, data, router, t, toast, user]
  );

  // Countdown. `startedAt` is authoritative so re-opening a timed quiz does not
  // hand the student a fresh clock.
  useEffect(() => {
    if (!data?.quiz.timeLimit) return;
    const startedAt = toDate(data.attempt.startedAt) ?? new Date();
    const endsAt = startedAt.getTime() + data.quiz.timeLimit * 60_000;

    const tick = () => {
      const remaining = Math.floor((endsAt - Date.now()) / 1000);
      setSecondsLeft(remaining);
      if (remaining <= 0) void handleSubmit(true);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [data?.attempt.id, data?.quiz.timeLimit, handleSubmit]);

  // Android back should ask, not silently abandon the attempt.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submittedRef.current) return false;
      setConfirming(true);
      return true;
    });
    return () => subscription.remove();
  }, []);

  const choose = async (questionId: string, optionIndex: number) => {
    const next = { ...answers, [questionId]: optionIndex };
    setAnswers(next);
    if (data) void saveProgress(data.attempt.id, next).catch(() => undefined);
  };

  const questions = data?.questions ?? [];
  const question = questions[index];
  const answered = Object.keys(answers).length;
  const unanswered = questions.length - answered;
  const isLast = index === questions.length - 1;
  const lowTime = secondsLeft !== null && secondsLeft <= 60;

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={data?.quiz.title ?? t('quiz.title')}
        subtitle={
          questions.length
            ? t('quiz.questionProgress', { current: index + 1, total: questions.length })
            : undefined
        }
        showBack
        onBack={() => setConfirming(true)}
        right={
          secondsLeft !== null ? (
            <View style={[styles.timer, lowTime ? styles.timerLow : null]}>
              <Ionicons
                name="time-outline"
                size={14}
                color={lowTime ? colors.textInverse : colors.textInverse}
              />
              <Text style={styles.timerText}>{formatCountdown(secondsLeft)}</Text>
            </View>
          ) : undefined
        }
      />

      <Screen>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={questions.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={4} />}
          emptyProps={{ icon: 'help-circle-outline', title: t('quiz.noQuizzes') }}
        >
          {question ? (
            <>
              <View
                style={styles.progressTrack}
                accessibilityRole="progressbar"
                accessibilityValue={{ now: index + 1, min: 1, max: questions.length }}
              >
                <View
                  style={[
                    styles.progressFill,
                    { width: `${((index + 1) / questions.length) * 100}%` },
                  ]}
                />
              </View>

              <Spacer />

              <Card>
                <Text style={styles.questionNumber}>
                  {t('quiz.questionProgress', { current: index + 1, total: questions.length })}
                  {question.marks ? ` · ${question.marks} ${t('quiz.marks')}` : ''}
                </Text>
                <Text style={styles.questionText} accessibilityRole="header">
                  {question.text}
                </Text>
              </Card>

              <Spacer />

              <View style={{ gap: spacing.md }}>
                {question.options.map((option, optionIndex) => {
                  const selected = answers[question.id] === optionIndex;
                  return (
                    <Pressable
                      key={optionIndex}
                      onPress={() => choose(question.id, optionIndex)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={option}
                      style={({ pressed }) => [
                        styles.option,
                        selected ? styles.optionSelected : null,
                        { opacity: pressed ? 0.9 : 1 },
                      ]}
                    >
                      <View style={[styles.optionLetter, selected ? styles.optionLetterSelected : null]}>
                        <Text
                          style={[styles.optionLetterText, selected ? styles.optionLetterTextSelected : null]}
                        >
                          {String.fromCharCode(65 + optionIndex)}
                        </Text>
                      </View>
                      <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
                        {option}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <Spacer size={spacing.xxl} />

              <View style={styles.navRow}>
                <Button
                  label={t('common.previous')}
                  icon="chevron-back"
                  variant="outline"
                  disabled={index === 0}
                  onPress={() => setIndex((i) => Math.max(0, i - 1))}
                  style={{ flex: 1 }}
                />
                {isLast ? (
                  <Button
                    label={t('quiz.submitQuiz')}
                    icon="checkmark-done"
                    onPress={() => setConfirming(true)}
                    loading={submitting}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <Button
                    label={t('common.next')}
                    icon="chevron-forward"
                    iconPosition="right"
                    onPress={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                    style={{ flex: 1 }}
                  />
                )}
              </View>

              <Spacer />

              {/* Question map — lets a student jump back to anything unanswered. */}
              <View style={styles.map}>
                {questions.map((item, itemIndex) => {
                  const done = answers[item.id] !== undefined;
                  const current = itemIndex === index;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => setIndex(itemIndex)}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('quiz.questionText')} ${itemIndex + 1}`}
                      style={[
                        styles.mapDot,
                        done ? styles.mapDotDone : null,
                        current ? styles.mapDotCurrent : null,
                      ]}
                    >
                      <Text style={[styles.mapDotText, done ? styles.mapDotTextDone : null]}>
                        {itemIndex + 1}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Spacer size={spacing.xxxl} />
            </>
          ) : null}
        </AsyncBoundary>
      </Screen>

      <ConfirmDialog
        visible={confirming}
        title={t('quiz.submitQuiz')}
        message={
          unanswered > 0
            ? `${t('quiz.unanswered', { count: unanswered })}\n${t('quiz.submitConfirm')}`
            : t('quiz.submitConfirm')
        }
        confirmLabel={t('common.submit')}
        loading={submitting}
        onCancel={() => setConfirming(false)}
        onConfirm={() => handleSubmit(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  timerLow: { backgroundColor: colors.danger },
  timerText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  questionNumber: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  questionText: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: fontWeight.semibold,
    lineHeight: 25,
    marginTop: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    minHeight: 60,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionLetter: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLetterSelected: { backgroundColor: colors.accent },
  optionLetterText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
  },
  optionLetterTextSelected: { color: colors.textInverse },
  optionText: { flex: 1, fontSize: fontSize.md, color: colors.text, lineHeight: 21 },
  optionTextSelected: { fontWeight: fontWeight.medium, color: colors.text },
  navRow: { flexDirection: 'row', gap: spacing.md },
  map: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  mapDot: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  mapDotDone: { backgroundColor: colors.accentSoft },
  mapDotCurrent: { borderColor: colors.accent },
  mapDotText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.medium },
  mapDotTextDone: { color: colors.accentDark, fontWeight: fontWeight.bold },
});
