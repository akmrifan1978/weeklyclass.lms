import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import * as translateService from '@/services/translateService';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatCountdown, toDate } from '@/utils/date';
import { friendlyMessage } from '@/utils/errors';
import type { LanguageCode } from '@/types';
import { saveProgress, startAttempt, submitAttempt } from '@/services/quizService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Card,
  ConfirmDialog,
  FormSheet,
  Screen,
  SkeletonList,
  Spacer,
} from '@/components/ui';
import { GuestGate } from '@/components/shared/GuestGate';

/**
 * Quiz player.
 *
 * Answers are written back to the attempt as the student moves between
 * questions, so a dropped connection or a closed app does not lose progress.
 * When the timer runs out the attempt submits itself.
 */
function QuizPlayerInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [glosses, setGlosses] = useState<
    Record<string, { text?: string; loading?: boolean; error?: string }>
  >({});
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
  const gloss = (question && glosses[question.id]) ?? {};

  /**
   * Translates the question and its options in one request.
   *
   * The source is the language the assignment was WRITTEN in, which the quiz
   * records — assuming English would have produced nonsense the first time
   * somebody set an assignment in Tamil. The target is whatever the reader has
   * the app in, and where the two match there is nothing to translate and no
   * button to press.
   */
  const sourceLanguage = (data?.quiz.language ?? 'en') as LanguageCode;
  const canTranslate = Boolean(question) && sourceLanguage !== language;

  /**
   * Translated as the question appears, not on a tap.
   *
   * Somebody who has set the app to Tamil has already said which language they
   * read; asking them to say it again per question was making them work for
   * something they had asked for. Cached results cost nothing, so moving
   * through a paper a second time spends no allowance at all.
   */
  useEffect(() => {
    if (!question || !canTranslate) return;
    if (glosses[question.id]) return;
    void translateQuestion();
    // Keyed on the question, so paging forward translates the next one and
    // paging back reuses what is already held.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, canTranslate]);

  const translateQuestion = async () => {
    if (!question) return;
    const id = question.id;
    setGlosses((g) => ({ ...g, [id]: { loading: true } }));
    try {
      // One request for the question and every option together: reading the
      // question without the answers is no use, and four separate calls would
      // spend four times the daily allowance on a single screen.
      const source = [question.text, ...question.options].join('. ');
      const text = await translateService.translate(
        source,
        sourceLanguage,
        language as LanguageCode
      );
      setGlosses((g) => ({ ...g, [id]: { text } }));
    } catch (err) {
      const reason =
        err instanceof translateService.TranslationUnavailable ? err.reason : 'network';
      setGlosses((g) => ({ ...g, [id]: { error: t(`scripture.translateFailed_${reason}`) } }));
    }
  };
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

                {/*
                  A rough reading in the student's own language, on request.

                  An assignment is written in one language by whoever set it,
                  and a student who reads another was previously answering a
                  question they could not read. The original stays above — it is
                  what the marking is against, and a gloss must never be mistaken
                  for the question itself.

                  Question and options together, in one request, because reading
                  the question without the answers is no use and asking for four
                  separate translations would spend four times the daily
                  allowance on one screen.
                */}
                {gloss.text ? (
                  <View style={styles.glossBlock}>
                    <Text style={styles.glossLabel}>{t('quiz.roughTranslation')}</Text>
                    <Text style={styles.glossText}>{gloss.text}</Text>
                    <Text style={styles.glossNote}>{t('quiz.roughTranslationNote')}</Text>
                  </View>
                ) : gloss.error ? (
                  <Text style={styles.glossError}>{gloss.error}</Text>
                ) : gloss.loading ? (
                  <Text style={styles.glossLabel}>{t('scripture.translating')}</Text>
                ) : canTranslate ? (
                  <Pressable
                    onPress={() => void translateQuestion()}
                    accessibilityRole="button"
                    style={styles.glossButton}
                  >
                    <Ionicons name="language-outline" size={13} color={colors.primary} />
                    <Text style={styles.glossButtonText}>{t('quiz.translateQuestion')}</Text>
                  </Pressable>
                ) : null}
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

      {/*
        Three ways out, not two.

        This used to offer Cancel or Submit, which are both ways of NOT leaving:
        one returns to the questions, the other ends the attempt for good. A
        student who opened an assignment and did not want to continue had
        neither, and their only remaining move was to force-close the app.

        Leaving is safe and always was — every answer is written to the attempt
        as it is chosen, so walking away keeps them and the assignment can be
        picked up again. The button simply never existed.
      */}
      <FormSheet
        visible={confirming}
        title={t('quiz.leaveTitle')}
        onClose={() => setConfirming(false)}
        onSubmit={() => handleSubmit(false)}
        submitLabel={t('common.submit')}
        submitting={submitting}
      >
        <Text style={styles.exitLead}>
          {unanswered > 0
            ? t('quiz.unanswered', { count: unanswered })
            : t('quiz.allAnswered')}
        </Text>

        <Button
          label={t('quiz.leaveWithoutSubmitting')}
          icon="exit-outline"
          variant="outline"
          fullWidth
          onPress={() => {
            setConfirming(false);
            router.back();
          }}
        />
        <Text style={styles.exitNote}>
          {data?.quiz.timeLimit ? t('quiz.leaveNoteTimed') : t('quiz.leaveNote')}
        </Text>
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  glossButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  glossButtonText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
  glossBlock: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  glossLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  glossText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 21 },
  glossNote: { fontSize: 10, color: colors.textMuted, marginTop: 6, lineHeight: 14 },
  glossError: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.md },
  exitLead: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  exitNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
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

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function QuizPlayer() {
  return (
    <GuestGate messageKey="guestMode.assignments" titleKey="quiz.title">
      <QuizPlayerInner />
    </GuestGate>
  );
}
