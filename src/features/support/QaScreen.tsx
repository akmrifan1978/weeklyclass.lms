import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { relativeTime } from '@/utils/date';
import * as support from '@/services/supportService';
import { useBranding } from '@/hooks/useBranding';
import { AyahAudio } from '@/features/islamic/AyahAudio';
import { VoiceRecorder } from './VoiceRecorder';
import type { QaQuestion } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
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
  // The Mowlavis a question can be for, live from Settings.
  const { scholars } = useBranding();
  // Named beside the title only when there is exactly one to name.
  const scholar = scholars.length === 1 ? scholars[0].name : '';
  const [scholarId, setScholarId] = useState<string | null>(null);

  // Starts on the first Mowlavi, so asking never stops to demand a choice.
  // Re-chosen if the one selected is removed from the list.
  useEffect(() => {
    if (!scholars.length) {
      if (scholarId) setScholarId(null);
      return;
    }
    if (!scholarId || !scholars.some((s) => s.id === scholarId)) setScholarId(scholars[0].id);
  }, [scholars, scholarId]);
  const { t } = useTranslation();
  const toast = useToast();
  const { user, can } = useAuth();

  const isStaff = user?.role === 'admin' || user?.role === 'teacher';

  const [question, setQuestion] = useState('');
  const [voice, setVoice] = useState<{ url: string; seconds: number } | null>(null);
  const [answering, setAnswering] = useState<QaQuestion | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [answerVoice, setAnswerVoice] = useState<{ url: string; seconds: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  // Correcting or withdrawing your own question.
  const [editing, setEditing] = useState<QaQuestion | null>(null);
  const [editText, setEditText] = useState('');
  const [editVoice, setEditVoice] = useState<{ url: string; seconds: number } | null>(null);
  const [editScholarId, setEditScholarId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QaQuestion | null>(null);

  /*
   * A clock for the edit window.
   *
   * The ten minutes run out whether or not anything else changes on screen,
   * so without this the Edit button would sit there after its window closed
   * and fail when pressed. Half a minute is fine enough for a window measured
   * in whole minutes.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

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
    /*
     * Either a written question or a spoken one. Both, if you like.
     *
     * There was a five-character minimum on the text, and it applied even when
     * a recording was attached — so somebody who could speak their question but
     * not type it was refused. The reasoning was that a list of unlabelled play
     * buttons cannot be scanned, which is true, and is now solved by LABELLING
     * such a question in the list rather than by demanding the asker type
     * something first.
     *
     * The only rule left is that a question has to contain something. "Ask" on
     * an empty form with no recording is not a short question, it is a slip.
     */
    if (!user) return;
    if (!question.trim() && !voice) {
      toast.error(t('qa.sayOrWriteSomething'));
      return;
    }
    setBusy(true);
    try {
      await support.askQuestion(
        {
          question,
          audioUrl: voice?.url ?? null,
          audioSeconds: voice?.seconds ?? null,
          eventId: eventId ?? null,
          scholarId: scholars.find((s) => s.id === scholarId)?.id ?? null,
          scholarName: scholars.find((s) => s.id === scholarId)?.name ?? null,
        },
        user
      );
      setQuestion('');
      setVoice(null);
      toast.success(t('qa.asked'));
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const answer = async () => {
    /*
     * The same freedom for whoever answers.
     *
     * A teacher could not reply with a recording alone either — the answer
     * needed two characters of text before the button did anything, and it
     * failed silently, which is the worst way for a form to refuse. A spoken
     * answer is often the better one here: explaining tajweed by voice beats
     * describing it in writing.
     */
    if (!answering || !user) return;
    if (!answerText.trim() && !answerVoice) {
      toast.error(t('qa.sayOrWriteSomething'));
      return;
    }
    setBusy(true);
    try {
      await support.answerQuestion(answering.id, answerText, answering, user, {
        url: answerVoice?.url ?? null,
        seconds: answerVoice?.seconds ?? null,
      });
      toast.success(t('qa.answered'));
      setAnswering(null);
      setAnswerText('');
      setAnswerVoice(null);
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (item: QaQuestion) => {
    setEditing(item);
    setEditText(item.question ?? '');
    setEditScholarId(item.scholarId ?? null);
    setEditVoice(
      item.audioUrl ? { url: item.audioUrl, seconds: item.audioSeconds ?? 0 } : null
    );
  };

  const saveEdit = async () => {
    if (!editing || !user) return;
    // Checked again at the moment of saving, not only when the sheet opened.
    // Somebody can open it in the ninth minute and press save in the twelfth.
    if (!support.canChangeOwnQuestion(editing, user, Date.now())) {
      toast.error(t('qa.editWindow', { minutes: 0 }));
      setEditing(null);
      return;
    }
    if (!editText.trim() && !editVoice) {
      toast.error(t('qa.sayOrWriteSomething'));
      return;
    }
    setBusy(true);
    try {
      await support.editQuestion(
        editing,
        {
          question: editText,
          audioUrl: editVoice?.url ?? null,
          audioSeconds: editVoice?.seconds ?? null,
          // Only when a list exists to choose from; otherwise left as it was.
          ...(scholars.length
            ? {
                scholarId: editScholarId,
                scholarName: scholars.find((s) => s.id === editScholarId)?.name ?? editing.scholarName ?? null,
              }
            : {}),
        },
        user
      );
      toast.success(t('qa.updated'));
      setEditing(null);
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const removeQuestion = async (item: QaQuestion) => {
    if (!user) return;
    try {
      await support.deleteQuestion(item, user);
      toast.success(t('qa.removed'));
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
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
      {/* Named when an admin has said who answers. Students ask more readily
          of a person than of a feature. */}
      <AppHeader
        title={t('nav.qa')}
        subtitle={scholar ? t('qa.withScholar', { name: scholar }) : undefined}
        showBack
      />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Card style={styles.askCard}>
          <Text style={styles.askTitle}>{t('qa.askTitle')}</Text>
          <Text style={styles.askHint}>{t('qa.askHint')}</Text>
          <ScholarChoice scholars={scholars} value={scholarId} onChange={setScholarId} />
          <TextField
            value={question}
            onChangeText={setQuestion}
            placeholder={t('qa.placeholder')}
            multiline
          />

          <View style={styles.voiceRow}>
            {user ? (
              <VoiceRecorder
                ownerId={user.uid}
                onRecorded={(url, seconds) => setVoice({ url, seconds })}
              />
            ) : null}
            {voice ? (
              <View style={styles.attached}>
                <AyahAudio url={voice.url} size={28} />
                <Text style={styles.attachedText}>
                  {t('qa.voiceAttached', { seconds: voice.seconds })}
                </Text>
                <IconButton
                  icon="close"
                  label={t('common.clear')}
                  size={28}
                  color={colors.danger}
                  onPress={() => setVoice(null)}
                />
              </View>
            ) : null}
          </View>

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
          <ErrorState error={error} onRetry={reload} />
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
              {/* Who it was asked of — the name it was asked with, kept on the
                  question, so it stays right after the list changes. */}
              {item.scholarName ? (
                <View style={styles.scholarPill}>
                  <Ionicons name="person-circle-outline" size={14} color={colors.primary} />
                  <Text style={styles.scholarPillText} numberOfLines={1}>
                    {t('qa.forScholar', { name: item.scholarName })}
                  </Text>
                </View>
              ) : null}
              {item.question ? (
                <Text style={styles.question}>{item.question}</Text>
              ) : (
                // Spoken only. Labelled rather than left blank, so the list is
                // still scannable — this is what the old text minimum was for.
                <Text style={[styles.question, styles.spokenOnly]}>
                  {t('qa.spokenOnly')}
                </Text>
              )}

              {item.audioUrl ? (
                <View style={styles.playRow}>
                  <AyahAudio url={item.audioUrl} size={30} />
                  <Text style={styles.playLabel}>
                    {t('qa.spokenQuestion', { seconds: item.audioSeconds ?? 0 })}
                  </Text>
                </View>
              ) : null}

              {item.answer || item.answerAudioUrl ? (
                <View style={styles.answer}>
                  <View style={styles.answerHeader}>
                    <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                    <Text style={styles.answerBy}>
                      {item.answeredByName ?? t('support.team')}
                    </Text>
                  </View>
                  {item.answer ? (
                    <Text style={styles.answerText}>{item.answer}</Text>
                  ) : (
                    <Text style={[styles.answerText, styles.spokenOnly]}>
                      {t('qa.spokenAnswerOnly')}
                    </Text>
                  )}
                  {item.answerAudioUrl ? (
                    <View style={styles.playRow}>
                      <AyahAudio url={item.answerAudioUrl} size={30} />
                      <Text style={styles.playLabel}>
                        {t('qa.spokenAnswer', { seconds: item.answerAudioSeconds ?? 0 })}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.pending}>{t('qa.awaitingAnswer')}</Text>
              )}

              {/* The asker's own controls, for as long as the window is open and
                  nobody has answered. They disappear by themselves when it
                  closes — see the clock above. */}
              {support.canChangeOwnQuestion(item, user, now) ? (
                <View style={styles.ownerRow}>
                  <Text style={styles.windowText}>
                    {t('qa.editWindow', { minutes: support.editMinutesLeft(item, now) })}
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      label={t('common.edit')}
                      icon="create-outline"
                      size="sm"
                      variant="outline"
                      onPress={() => openEdit(item)}
                    />
                    <Button
                      label={t('common.delete')}
                      icon="trash-outline"
                      size="sm"
                      variant="ghost"
                      onPress={() => setConfirmDelete(item)}
                    />
                  </View>
                </View>
              ) : null}

              {isStaff ? (
                <View style={styles.actions}>
                  <Button
                    label={item.answer || item.answerAudioUrl ? t('qa.editAnswer') : t('qa.answer')}
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
                  {/* Only an admin deletes somebody else's question. A teacher
                      hides it, which keeps what the student wrote. */}
                  {user?.role === 'admin' ? (
                    <IconButton
                      icon="trash-outline"
                      label={t('common.delete')}
                      size={32}
                      color={colors.danger}
                      onPress={() => setConfirmDelete(item)}
                    />
                  ) : null}
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
        {/* Not `required`: an answer may be spoken instead of written, and
            marking it required puts an asterisk beside a field somebody is
            entitled to leave empty. */}
        <TextField
          label={t('qa.yourAnswer')}
          value={answerText}
          onChangeText={setAnswerText}
          multiline
          hint={t('qa.answerHint')}
        />
        <View style={styles.voiceRow}>
          {user ? (
            <VoiceRecorder
              ownerId={user.uid}
              onRecorded={(url, seconds) => setAnswerVoice({ url, seconds })}
            />
          ) : null}
          {answerVoice ? (
            <View style={styles.attached}>
              <AyahAudio url={answerVoice.url} size={28} />
              <IconButton
                icon="close"
                label={t('common.clear')}
                size={28}
                color={colors.danger}
                onPress={() => setAnswerVoice(null)}
              />
            </View>
          ) : null}
        </View>
      </FormSheet>

      <FormSheet
        visible={Boolean(editing)}
        title={t('qa.editTitle')}
        onClose={() => setEditing(null)}
        onSubmit={saveEdit}
        submitting={busy}
      >
        <ScholarChoice scholars={scholars} value={editScholarId} onChange={setEditScholarId} />
        {/* Text, recording, or both — the same freedom as asking. */}
        <TextField
          value={editText}
          onChangeText={setEditText}
          placeholder={t('qa.placeholder')}
          multiline
        />
        <View style={styles.voiceRow}>
          {editVoice ? (
            <View style={styles.attached}>
              <AyahAudio url={editVoice.url} size={28} />
              <Text style={styles.attachedText}>
                {t('qa.voiceAttached', { seconds: editVoice.seconds })}
              </Text>
              <IconButton
                icon="close"
                label={t('common.clear')}
                size={28}
                color={colors.danger}
                onPress={() => setEditVoice(null)}
              />
            </View>
          ) : null}
          {user ? (
            <VoiceRecorder
              ownerId={user.uid}
              onRecorded={(url, seconds) => setEditVoice({ url, seconds })}
            />
          ) : null}
        </View>
        {editVoice ? <Text style={styles.windowText}>{t('qa.replaceRecording')}</Text> : null}
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t('qa.deleteConfirm')}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void removeQuestion(target);
        }}
      />
    </>
  );
}

/**
 * Choosing the Mowlavi a question is for.
 *
 * Chips that wrap, so they suit a phone, a tablet and a desktop without a
 * dropdown — every choice visible, one tap each. Hidden when there is nobody
 * to choose between.
 */
function ScholarChoice({
  scholars,
  value,
  onChange,
}: {
  scholars: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (scholars.length === 0) return null;

  return (
    <View style={styles.scholarWrap}>
      <Text style={styles.scholarLabel}>{t('qa.chooseScholar')}</Text>
      <View style={styles.scholarChips}>
        {scholars.map((scholar) => {
          const on = scholar.id === value;
          return (
            <Pressable
              key={scholar.id}
              onPress={() => onChange(scholar.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={scholar.name}
              style={[styles.scholarChip, on && styles.scholarChipOn]}
            >
              <Text style={[styles.scholarChipText, on && styles.scholarChipTextOn]} numberOfLines={1}>
                {scholar.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  askCard: { marginBottom: spacing.lg },
  scholarWrap: { marginBottom: spacing.md },
  scholarLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  scholarChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scholarChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  scholarChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  scholarChipText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  scholarChipTextOn: { color: colors.textInverse },
  scholarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  scholarPillText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
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
  spokenOnly: { fontStyle: 'italic', color: colors.textSecondary },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  attached: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  attachedText: { fontSize: fontSize.xs, color: colors.textSecondary },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  playLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  ownerRow: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  windowText: { fontSize: fontSize.xs, color: colors.textMuted },
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
