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
import { getSettings } from '@/services/settingsService';
import type { SupportKind, SupportRequest } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Screen,
  SectionHeader,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * Help, feedback and complaints — one screen, because from where the person is
 * standing they are the same act: something needs saying to whoever runs this.
 * Making them choose between four separate menu entries first would only make
 * them pick wrong.
 *
 * The helpline sits above the form on purpose. Someone who needs an answer today
 * should not have to read past a message box to find the phone number.
 */

const KINDS: SupportKind[] = ['question', 'feedback', 'complaint', 'contact'];

export function SupportScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const [kind, setKind] = useState<SupportKind>('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [settings, mine] = await Promise.all([
      getSettings(),
      user
        ? support.listMyRequests(user).then((page) => page.items)
        : Promise.resolve([] as SupportRequest[]),
    ]);
    return { settings, mine };
  }, [user?.uid]);

  const { data, loading, refreshing, refresh, reload } = useAsync(load, [load]);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!subject.trim()) next.subject = 'validation.fieldRequired';
    if (message.trim().length < 5) next.message = 'support.messageTooShort';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    if (!user) return;

    setBusy(true);
    try {
      await support.submitRequest({ kind, subject, message }, user);
      toast.success(t('support.sent'));
      setSubject('');
      setMessage('');
      setErrors({});
      void reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const helpline = data?.settings.contactPhone?.trim();
  const email = data?.settings.supportEmail?.trim();
  const whatsapp = data?.settings.social?.whatsapp?.trim();

  return (
    <>
      <AppHeader title={t('nav.support')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <SectionHeader title={t('support.helpline')} icon="call-outline" />
        <Card style={styles.helplineCard}>
          {helpline || email || whatsapp ? (
            <>
              {helpline ? (
                <ContactRow
                  icon="call"
                  label={t('support.callUs')}
                  value={helpline}
                  onPress={() => Linking.openURL(`tel:${helpline}`)}
                />
              ) : null}
              {whatsapp ? (
                <ContactRow
                  icon="logo-whatsapp"
                  label="WhatsApp"
                  value={whatsapp}
                  onPress={() =>
                    Linking.openURL(
                      // wa.me wants digits only; anything else and the link dies.
                      `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`
                    )
                  }
                />
              ) : null}
              {email ? (
                <ContactRow
                  icon="mail"
                  label={t('auth.email')}
                  value={email}
                  onPress={() => Linking.openURL(`mailto:${email}`)}
                />
              ) : null}
            </>
          ) : (
            <Text style={styles.noHelpline}>{t('support.noHelpline')}</Text>
          )}
        </Card>

        <SectionHeader title={t('support.writeToUs')} icon="chatbox-ellipses-outline" />
        <Card>
          <ChipGroup<SupportKind>
            options={KINDS.map((k) => ({ value: k, label: t(`support.kind_${k}`) }))}
            value={kind}
            onChange={setKind}
            style={{ marginBottom: spacing.lg }}
          />
          <Text style={styles.kindHint}>{t(`support.kindHint_${kind}`)}</Text>

          <TextField
            label={t('support.subject')}
            value={subject}
            onChangeText={setSubject}
            error={errors.subject}
            icon="text-outline"
            required
          />
          <TextField
            label={t('support.message')}
            value={message}
            onChangeText={setMessage}
            error={errors.message}
            multiline
            required
          />
          <Button
            label={t('support.send')}
            icon="send"
            onPress={submit}
            loading={busy}
            fullWidth
          />
        </Card>

        <SectionHeader title={t('support.myRequests')} icon="time-outline" />
        {loading ? (
          <SkeletonList count={2} />
        ) : (data?.mine.length ?? 0) === 0 ? (
          <EmptyState icon="chatbubbles-outline" title={t('support.nothingYet')} />
        ) : (
          data?.mine.map((request) => (
            <Card key={request.id} style={styles.request}>
              <View style={styles.requestHeader}>
                <View style={styles.kindChip}>
                  <Text style={styles.kindChipText}>
                    {t(`support.kind_${request.kind}`)}
                  </Text>
                </View>
                <Text style={styles.requestDate}>{relativeTime(request.createdAt)}</Text>
              </View>
              <Text style={styles.requestSubject}>{request.subject}</Text>
              <Text style={styles.requestMessage}>{request.message}</Text>

              {request.reply ? (
                <View style={styles.reply}>
                  <View style={styles.replyHeader}>
                    <Ionicons name="return-down-forward" size={14} color={colors.success} />
                    <Text style={styles.replyFrom}>
                      {request.repliedByName ?? t('support.team')}
                    </Text>
                  </View>
                  <Text style={styles.replyText}>{request.reply}</Text>
                </View>
              ) : (
                <Text style={styles.awaiting}>{t('support.awaitingReply')}</Text>
              )}
            </Card>
          ))
        )}
      </Screen>
    </>
  );
}

function ContactRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.contactRow, pressed ? styles.pressed : null]}
    >
      <View style={styles.contactIcon}>
        <Ionicons name={icon} size={18} color={brand.orange} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={styles.contactValue}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  helplineCard: { paddingVertical: spacing.xs },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.6 },
  contactIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  contactValue: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  noHelpline: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    paddingVertical: spacing.md,
    lineHeight: 20,
  },
  kindHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.lg,
    lineHeight: 17,
  },
  request: { marginBottom: spacing.md },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  kindChip: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  kindChipText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  requestDate: { fontSize: fontSize.xs, color: colors.textMuted },
  requestSubject: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  requestMessage: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  reply: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
  },
  replyHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  replyFrom: { fontSize: fontSize.xs, color: colors.success, fontWeight: fontWeight.bold },
  replyText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  awaiting: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
});
