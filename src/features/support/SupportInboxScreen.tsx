import React, { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { relativeTime } from '@/utils/date';
import * as support from '@/services/supportService';
import { LANGUAGES } from '@/constants/app';
import { translate, TranslationUnavailable } from '@/services/translateService';
import type { LanguageCode, SupportRequest, SupportStatus } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  FormSheet,
  IconButton,
  RatingBadge,
  Screen,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * The admin's inbox for feedback, complaints and questions.
 *
 * Defaults to the open ones. An inbox that opens on everything ever received
 * buries the three things that still need doing under six months of settled
 * ones, which is how requests get missed.
 */
export function SupportInboxScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const [status, setStatus] = useState<SupportStatus>('open');
  const [replying, setReplying] = useState<SupportRequest | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => support.listRequests({ status, pageSize: 50 }).then((page) => page.items),
    [status]
  );
  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const sendReply = async () => {
    if (!replying || !user || replyText.trim().length < 2) return;
    setBusy(true);
    try {
      const outcome = await support.replyToRequest(replying.id, replyText, replying, user);
      // Two different things happened, and they get two different sentences.
      // "Sent" when the student was told; a warning when the reply is saved but
      // nobody was notified, which used to look identical from here.
      if (outcome.notified) toast.success(t('support.replySent'));
      else toast.error(t('support.replySentNotNotified'));
      setReplying(null);
      setReplyText('');
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const close = async (request: SupportRequest) => {
    if (!user) return;
    try {
      await support.closeRequest(request.id, user);
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  return (
    <>
      <AppHeader title={t('nav.support')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <ChipGroup<SupportStatus>
          options={[
            { value: 'open', label: t('support.statusOpen') },
            { value: 'answered', label: t('support.statusAnswered') },
            { value: 'closed', label: t('support.statusClosed') },
          ]}
          value={status}
          onChange={setStatus}
          style={{ marginBottom: spacing.lg }}
        />

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
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState icon="checkmark-done-outline" title={t('support.inboxClear')} />
        ) : (
          data?.map((request) => (
            <Card key={request.id} style={styles.card}>
              <View style={styles.header}>
                <View style={styles.kindChip}>
                  <Text style={styles.kindText}>{t(`support.kind_${request.kind}`)}</Text>
                </View>
                <Text style={styles.date}>{relativeTime(request.createdAt)}</Text>
              </View>

              <Text style={styles.subject}>{request.subject}</Text>

              {request.rating ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <RatingBadge value={request.rating} />
                </View>
              ) : null}

              <Message request={request} />

              <View style={styles.fromRow}>
                <Ionicons name="person-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.from}>
                  {/* A password-help request has no role to show, because it was
                      filed by somebody who could not sign in. The name is
                      whatever they typed at the login box, so it is labelled as
                      unverified rather than dressed up as an account. */}
                  {request.userRole
                    ? `${request.userName} · ${t(`admin.role${capitalise(request.userRole)}`)}`
                    : `${request.userName} · ${t('support.notSignedIn')}`}
                </Text>
                {/* The number is right here so a complaint can be answered with a
                    phone call, which is often the only reply that will do. */}
                {request.userMobile ? (
                  <IconButton
                    icon="call-outline"
                    label={t('support.callUs')}
                    size={30}
                    color={colors.primary}
                    onPress={() => Linking.openURL(`tel:${request.userMobile}`)}
                  />
                ) : null}
              </View>

              {request.reply ? (
                <View style={styles.reply}>
                  <Text style={styles.replyFrom}>
                    {request.repliedByName ?? t('support.team')}
                  </Text>
                  <Text style={styles.replyText}>{request.reply}</Text>
                </View>
              ) : null}

              <View style={styles.actions}>
                <Button
                  label={request.reply ? t('support.replyAgain') : t('support.reply')}
                  icon="arrow-undo-outline"
                  size="sm"
                  onPress={() => {
                    setReplying(request);
                    setReplyText(request.reply ?? '');
                  }}
                />
                {request.status !== 'closed' ? (
                  <Button
                    label={t('support.close')}
                    icon="checkmark-done"
                    variant="ghost"
                    size="sm"
                    onPress={() => close(request)}
                  />
                ) : null}
              </View>
            </Card>
          ))
        )}
      </Screen>

      <FormSheet
        visible={Boolean(replying)}
        title={replying?.subject ?? t('support.reply')}
        onClose={() => setReplying(null)}
        onSubmit={sendReply}
        submitting={busy}
      >
        <Text style={styles.originalLabel}>{t('support.theirMessage')}</Text>
        <Text style={styles.original}>{replying?.message}</Text>
        <TextField
          label={t('support.yourReply')}
          value={replyText}
          onChangeText={setReplyText}
          multiline
          required
        />
      </FormSheet>
    </>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A message, and a way to read it when it is not in your language.
 *
 * The inbox is worked by a handful of admins; the people writing into it are
 * students across four languages. Before this, a complaint in Tamil reaching an
 * admin who reads English was a paragraph they could not act on, and the honest
 * outcome was that it got skipped.
 *
 * The original is never replaced, only added to. A machine translation of a
 * complaint is a rough gloss, and an admin about to reply to somebody upset
 * needs to be able to see the words they actually used — so both are on screen,
 * and the translation is labelled as one.
 */
function Message({ request }: { request: SupportRequest }) {
  const { t, i18n } = useTranslation();
  const [translated, setTranslated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const reading = (i18n.language || 'en').split('-')[0] as LanguageCode;
  const wrote = request.language ?? null;
  const worthTranslating = Boolean(wrote && wrote !== reading);

  const run = async () => {
    if (!wrote) return;
    setBusy(true);
    setFailed(null);
    try {
      setTranslated(await translate(request.message, wrote, reading));
    } catch (error) {
      // Same three sentences the scripture screens use — the failures are the
      // same failures, and a second set of words for them would only be a
      // second set to keep translated.
      const reason = error instanceof TranslationUnavailable ? error.reason : 'network';
      setFailed(`scripture.translateFailed_${reason}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={styles.message}>{request.message}</Text>

      {wrote ? (
        <View style={styles.languageRow}>
          <Ionicons name="language-outline" size={13} color={colors.textMuted} />
          <Text style={styles.languageText}>
            {LANGUAGES.find((item) => item.code === wrote)?.nativeName ?? wrote}
          </Text>
          {worthTranslating && !translated ? (
            <Pressable onPress={run} disabled={busy} accessibilityRole="button">
              <Text style={styles.translateAction}>
                {busy ? t('common.loading') : t('support.translate')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {translated ? (
        <View style={styles.translation}>
          <Text style={styles.translationLabel}>{t('support.machineTranslation')}</Text>
          <Text style={styles.translationText}>{translated}</Text>
        </View>
      ) : null}

      {failed ? <Text style={styles.translationFailed}>{t(failed)}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  languageText: { fontSize: fontSize.xs, color: colors.textMuted },
  translateAction: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
    marginLeft: spacing.sm,
  },
  translation: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  translationLabel: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  translationText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
  translationFailed: {
    fontSize: fontSize.xs,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  kindChip: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  kindText: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.bold },
  date: { fontSize: fontSize.xs, color: colors.textMuted },
  subject: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  message: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  from: { flex: 1, fontSize: fontSize.xs, color: colors.textMuted },
  reply: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
  },
  replyFrom: { fontSize: fontSize.xs, color: colors.success, fontWeight: fontWeight.bold },
  replyText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  originalLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  original: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
});
