import React, { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { relativeTime } from '@/utils/date';
import * as support from '@/services/supportService';
import type { SupportRequest, SupportStatus } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  FormSheet,
  IconButton,
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
      await support.replyToRequest(replying.id, replyText, replying, user);
      toast.success(t('support.replySent'));
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
              <Text style={styles.message}>{request.message}</Text>

              <View style={styles.fromRow}>
                <Ionicons name="person-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.from}>
                  {request.userName} · {t(`admin.role${capitalise(request.userRole)}`)}
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

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
