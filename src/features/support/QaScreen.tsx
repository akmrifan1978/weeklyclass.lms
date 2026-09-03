import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { relativeTime } from '@/utils/date';
import * as support from '@/services/supportService';
import type { QaQuestion } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  FormSheet,
  IconButton,
  Screen,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * Live Q&A — questions asked in the open, for the whole class to read.
 *
 * Not the same thing as a support request, which is private between one person
 * and the admin. The point of asking here is that the answer teaches everyone
 * who reads it, so answers are public and the class is notified when one lands.
 *
 * Unanswered questions sort to the top. During a live session that is the list
 * the teacher is working from, and burying them under yesterday's answered ones
 * would make it useless for the moment it exists to serve.
 */
export function QaScreen({ eventId }: { eventId?: string | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, can } = useAuth();

  const isStaff = user?.role === 'admin' || user?.role === 'teacher';

  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState<QaQuestion | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      support.listQuestions({
        // Staff see every class; a student sees their own.
        classId: isStaff ? null : (user?.classId ?? null),
        eventId: eventId ?? null,
      }),
    [isStaff, user?.classId, eventId]
  );
  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const sorted = [...(data ?? [])].sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === 'open' ? -1 : 1;
  });

  const ask = async () => {
    if (!user || question.trim().length < 5) {
      toast.error(t('qa.questionTooShort'));
      return;
    }
    setBusy(true);
    try {
      await support.askQuestion({ question, eventId: eventId ?? null }, user);
      setQuestion('');
      toast.success(t('qa.asked'));
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const answer = async () => {
    if (!answering || !user || answerText.trim().length < 2) return;
    setBusy(true);
    try {
      await support.answerQuestion(answering.id, answerText, answering, user);
      toast.success(t('qa.answered'));
      setAnswering(null);
      setAnswerText('');
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const hide = async (item: QaQuestion) => {
    if (!user) return;
    try {
      await support.hideQuestion(item.id, true, user);
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  return (
    <>
      <AppHeader title={t('nav.qa')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Card style={styles.askCard}>
          <Text style={styles.askTitle}>{t('qa.askTitle')}</Text>
          <Text style={styles.askHint}>{t('qa.askHint')}</Text>
          <TextField
            value={question}
            onChangeText={setQuestion}
            placeholder={t('qa.placeholder')}
            multiline
          />
          <Button
            label={t('qa.ask')}
            icon="help-circle-outline"
            onPress={ask}
            loading={busy}
            fullWidth
          />
        </Card>

        {loading ? (
          <SkeletonList count={3} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : sorted.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title={t('qa.none')} message={t('qa.noneHelp')} />
        ) : (
          sorted.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.qHeader}>
                <Ionicons name="help-circle" size={18} color={brand.orange} />
                <Text style={styles.asker}>{item.askedByName}</Text>
                <Text style={styles.date}>{relativeTime(item.createdAt)}</Text>
              </View>
              <Text style={styles.question}>{item.question}</Text>

              {item.answer ? (
                <View style={styles.answer}>
                  <View style={styles.answerHeader}>
                    <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                    <Text style={styles.answerBy}>
                      {item.answeredByName ?? t('support.team')}
                    </Text>
                  </View>
                  <Text style={styles.answerText}>{item.answer}</Text>
                </View>
              ) : (
                <Text style={styles.pending}>{t('qa.awaitingAnswer')}</Text>
              )}

              {isStaff ? (
                <View style={styles.actions}>
                  <Button
                    label={item.answer ? t('qa.editAnswer') : t('qa.answer')}
                    icon="create-outline"
                    size="sm"
                    onPress={() => {
                      setAnswering(item);
                      setAnswerText(item.answer ?? '');
                    }}
                  />
                  <IconButton
                    icon="eye-off-outline"
                    label={t('qa.hide')}
                    size={32}
                    color={colors.textMuted}
                    onPress={() => hide(item)}
                  />
                </View>
              ) : null}
            </Card>
          ))
        )}
      </Screen>

      <FormSheet
        visible={Boolean(answering)}
        title={t('qa.answer')}
        onClose={() => setAnswering(null)}
        onSubmit={answer}
        submitting={busy}
      >
        <Text style={styles.originalLabel}>{t('qa.theQuestion')}</Text>
        <Text style={styles.original}>{answering?.question}</Text>
        <TextField
          label={t('qa.yourAnswer')}
          value={answerText}
          onChangeText={setAnswerText}
          multiline
          required
        />
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  askCard: { marginBottom: spacing.lg },
  askTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  askHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  card: { marginBottom: spacing.md },
  qHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  asker: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  date: { fontSize: fontSize.xs, color: colors.textMuted },
  question: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  answer: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
  },
  answerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  answerBy: { fontSize: fontSize.xs, color: colors.success, fontWeight: fontWeight.bold },
  answerText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20, marginTop: 2 },
  pending: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  originalLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  original: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
});
