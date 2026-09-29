import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import {
  getQuiz,
  listQuestionsWithAnswers,
  saveQuestions,
  setQuizStatus,
  type QuestionDraft,
} from '@/services/quizService';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Card,
  ConfirmDialog,
  IconButton,
  Screen,
  SkeletonList,
  Spacer,
  StatusBadge,
  TextField,
} from '@/components/ui';

/**
 * Question builder.
 *
 * The whole question set is edited locally and saved in one batch, which keeps
 * the questions and their answer key consistent — the key lives in a separate
 * subcollection students cannot read until they have submitted.
 */
export function QuizEditor() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return null;
    const [quiz, questions] = await Promise.all([getQuiz(id), listQuestionsWithAnswers(id)]);
    return { quiz, questions };
  }, [id]);

  const { data, loading, error, reload } = useAsync(load, [id]);

  useEffect(() => {
    if (data?.questions) {
      setDrafts(data.questions);
      setDirty(false);
    }
  }, [data?.questions]);

  const update = (index: number, patch: Partial<QuestionDraft>) => {
    setDrafts((previous) =>
      previous.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );
    setDirty(true);
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    setDrafts((previous) =>
      previous.map((draft, i) =>
        i === questionIndex
          ? { ...draft, options: draft.options.map((o, j) => (j === optionIndex ? value : o)) }
          : draft
      )
    );
    setDirty(true);
  };

  const addQuestion = () => {
    setDrafts((previous) => [
      ...previous,
      { text: '', options: ['', '', '', ''], correctIndex: 0, marks: 1 },
    ]);
    setDirty(true);
  };

  const addOption = (questionIndex: number) => {
    setDrafts((previous) =>
      previous.map((draft, i) =>
        i === questionIndex && draft.options.length < 6
          ? { ...draft, options: [...draft.options, ''] }
          : draft
      )
    );
    setDirty(true);
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    setDrafts((previous) =>
      previous.map((draft, i) => {
        if (i !== questionIndex || draft.options.length <= 2) return draft;
        const options = draft.options.filter((_, j) => j !== optionIndex);
        // Keep the correct-answer pointer aimed at the same option.
        let correctIndex = draft.correctIndex;
        if (optionIndex === correctIndex) correctIndex = 0;
        else if (optionIndex < correctIndex) correctIndex -= 1;
        return { ...draft, options, correctIndex };
      })
    );
    setDirty(true);
  };

  const removeQuestion = (index: number) => {
    setDrafts((previous) => previous.filter((_, i) => i !== index));
    setConfirmRemove(null);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!user || !id) return;
    setBusy(true);
    try {
      await saveQuestions(id, drafts, user);
      toast.success(t('common.success'));
      setDirty(false);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!user || !id || !data?.quiz) return;
    if (drafts.length === 0) {
      toast.error(t('validation.minOneQuestion'));
      return;
    }
    setBusy(true);
    try {
      if (dirty) await saveQuestions(id, drafts, user);
      const publishing = data.quiz.status !== 'published';
      const { students } = await setQuizStatus(id, publishing ? 'published' : 'closed', user);
      // Say who can see it. Nobody is the answer that matters: it means the
      // assignment was given to a class group with no students in it.
      if (!publishing || students === null) toast.success(t('common.success'));
      else if (students === 0) toast.error(t('quiz.publishedNoStudents'));
      else toast.success(t('quiz.publishedTo', { count: students }));
      setDirty(false);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const totalMarks = drafts.reduce((sum, draft) => sum + (Number(draft.marks) || 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={data?.quiz?.title ?? t('quiz.editQuiz')}
        subtitle={`${drafts.length} ${t('quiz.questions')} · ${totalMarks} ${t('quiz.marks')}`}
        showBack
      />

      <Screen edges={['bottom']}>
        <AsyncBoundary
          loading={loading}
          error={error}
          onRetry={reload}
          skeleton={<SkeletonList count={3} />}
        >
          {data?.quiz ? (
            <>
              <Card style={styles.summary}>
                <View style={styles.summaryRow}>
                  <StatusBadge status={data.quiz.status} />
                  <Text style={styles.summaryMeta}>
                    {data.quiz.timeLimit
                      ? `${data.quiz.timeLimit} ${t('quiz.timeLimit')}`
                      : t('quiz.noTimeLimit')}
                  </Text>
                </View>
                {can('EDIT_QUIZ') ? (
                  <Button
                    label={t(data.quiz.status === 'published' ? 'quiz.closeQuiz' : 'quiz.publish')}
                    icon={data.quiz.status === 'published' ? 'lock-closed-outline' : 'send-outline'}
                    variant={data.quiz.status === 'published' ? 'outline' : 'primary'}
                    size="sm"
                    loading={busy}
                    onPress={handlePublish}
                    style={{ marginTop: spacing.md }}
                  />
                ) : null}
              </Card>

              <Spacer />

              {drafts.map((draft, questionIndex) => (
                <Card key={questionIndex} style={styles.questionCard}>
                  <View style={styles.questionHeader}>
                    <View style={styles.questionNumber}>
                      <Text style={styles.questionNumberText}>{questionIndex + 1}</Text>
                    </View>
                    <Text style={styles.questionLabel}>{t('quiz.questionText')}</Text>
                    <IconButton
                      icon="trash-outline"
                      label={t('common.delete')}
                      size={34}
                      color={colors.danger}
                      background={colors.dangerSoft}
                      onPress={() => setConfirmRemove(questionIndex)}
                    />
                  </View>

                  <TextField
                    value={draft.text}
                    onChangeText={(value) => update(questionIndex, { text: value })}
                    placeholder={t('quiz.questionText')}
                    multiline
                    containerStyle={{ marginBottom: spacing.md }}
                  />

                  {draft.options.map((option, optionIndex) => {
                    const isCorrect = draft.correctIndex === optionIndex;
                    return (
                      <View key={optionIndex} style={styles.optionRow}>
                        <Pressable
                          onPress={() => update(questionIndex, { correctIndex: optionIndex })}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: isCorrect }}
                          accessibilityLabel={`${t('quiz.correctAnswer')} ${String.fromCharCode(65 + optionIndex)}`}
                          style={[styles.correctToggle, isCorrect ? styles.correctToggleOn : null]}
                        >
                          <Ionicons
                            name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                            size={20}
                            color={isCorrect ? colors.success : colors.textMuted}
                          />
                        </Pressable>

                        <TextField
                          value={option}
                          onChangeText={(value) => updateOption(questionIndex, optionIndex, value)}
                          placeholder={t('quiz.option', { number: optionIndex + 1 })}
                          containerStyle={styles.optionField}
                        />

                        {draft.options.length > 2 ? (
                          <IconButton
                            icon="close"
                            label={t('common.delete')}
                            size={32}
                            color={colors.textMuted}
                            background={colors.transparent}
                            onPress={() => removeOption(questionIndex, optionIndex)}
                          />
                        ) : null}
                      </View>
                    );
                  })}

                  <View style={styles.questionFooter}>
                    {draft.options.length < 6 ? (
                      <Button
                        label={t('common.add')}
                        icon="add"
                        variant="ghost"
                        size="sm"
                        onPress={() => addOption(questionIndex)}
                      />
                    ) : (
                      <View />
                    )}
                    <TextField
                      label={t('quiz.marks')}
                      value={String(draft.marks)}
                      onChangeText={(value) =>
                        update(questionIndex, { marks: Number(value.replace(/[^0-9]/g, '')) || 0 })
                      }
                      keyboardType="number-pad"
                      containerStyle={styles.marksField}
                    />
                  </View>

                  <TextField
                    label={t('quiz.explanation')}
                    value={draft.explanation ?? ''}
                    onChangeText={(value) => update(questionIndex, { explanation: value })}
                    multiline
                    containerStyle={{ marginBottom: 0 }}
                  />
                </Card>
              ))}

              <Button
                label={t('quiz.addQuestion')}
                icon="add-circle-outline"
                variant="outline"
                fullWidth
                onPress={addQuestion}
                style={{ marginTop: spacing.md }}
              />

              <Spacer />

              <Button
                label={t('common.save')}
                icon="save-outline"
                fullWidth
                size="lg"
                loading={busy}
                disabled={!dirty || drafts.length === 0}
                onPress={handleSave}
              />

              <Spacer size={spacing.xxxl} />
            </>
          ) : null}
        </AsyncBoundary>
      </Screen>

      <ConfirmDialog
        visible={confirmRemove !== null}
        title={t('confirm.deleteTitle')}
        message={t('confirm.deleteMessage')}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove !== null && removeQuestion(confirmRemove)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { marginTop: spacing.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  questionCard: { marginBottom: spacing.lg },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  questionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionNumberText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.accentDark,
  },
  questionLabel: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  correctToggle: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  correctToggleOn: { backgroundColor: colors.successSoft },
  optionField: { flex: 1 },
  questionFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  marksField: { flex: 0, width: 100 },
});
