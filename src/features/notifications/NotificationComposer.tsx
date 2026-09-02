import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatDateTime, relativeTime, toISODate } from '@/utils/date';
import { friendlyMessage } from '@/utils/errors';
import { truncate } from '@/utils/format';
import {
  cancelScheduled,
  listAllNotifications,
  send,
} from '@/services/notificationService';
import { listBranches, listClasses } from '@/services/orgService';
import { listUsers } from '@/services/userService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import type {
  AppNotification,
  NotificationCategory,
  NotificationTarget,
} from '@/types';
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  FormSheet,
  Screen,
  SectionHeader,
  SkeletonList,
  Select,
  Spacer,
  TextField,
  TimeField,
  type Option,
} from '@/components/ui';

interface ComposeForm {
  title: string;
  message: string;
  category: NotificationCategory;
  targetRole: NotificationTarget;
  targetClassId: string;
  targetBranchId: string;
  userId: string;
  route: string;
  scheduleDate: string;
  scheduleTime: string;
}

const EMPTY: ComposeForm = {
  title: '',
  message: '',
  category: 'general',
  targetRole: 'all',
  targetClassId: '',
  targetBranchId: '',
  userId: '',
  route: '',
  scheduleDate: '',
  scheduleTime: '',
};

/**
 * Notification centre.
 *
 * Immediate sends reach every targeted user in-app straight away and push to
 * registered devices through the Expo Push Service. Scheduled sends are stored
 * and surface in-app at the chosen moment; the honest limitation about device
 * push for scheduled items is shown on the form rather than buried in docs.
 */
export function NotificationComposer() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: string }>();

  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState<ComposeForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<AppNotification | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    const [branches, classPage, people] = await Promise.all([
      listBranches().catch(() => []),
      listClasses({ pageSize: 100 }).catch(() => ({ items: [], cursor: null, hasMore: false })),
      listUsers({ status: 'active', pageSize: 100 }).then((p) => p.items).catch(() => []),
    ]);
    return { branches, classes: classPage.items, people };
  }, []);

  const { data: refs } = useAsync(loadRefs, []);

  const loadHistory = useCallback(async () => {
    const page = await listAllNotifications({ pageSize: 40 });
    return page.items;
  }, []);

  const {
    data: history,
    loading,
    error,
    refreshing,
    refresh,
    reload,
  } = useAsync(loadHistory, []);

  useEffect(() => {
    if (params.action === 'new' && can('SEND_NOTIFICATIONS')) {
      setForm(EMPTY);
      setComposing(true);
      router.setParams({ action: undefined });
    }
  }, [params.action, can, router]);

  const branchOptions = useMemo<Option[]>(
    () => (refs?.branches ?? []).map((b) => ({ value: b.id, label: b.name })),
    [refs?.branches]
  );
  const classOptions = useMemo<Option[]>(
    () => (refs?.classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [refs?.classes]
  );
  const peopleOptions = useMemo<Option[]>(
    () =>
      (refs?.people ?? []).map((p) => ({
        value: p.uid,
        label: p.fullName,
        description: `${p.role} · ${p.email}`,
      })),
    [refs?.people]
  );

  const set = <K extends keyof ComposeForm>(key: K, value: ComposeForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key as string]) return previous;
      const next = { ...previous };
      delete next[key as string];
      return next;
    });
  };

  const handleSend = async () => {
    if (!user) return;

    const validationErrors: Record<string, string> = {};
    if (!form.title.trim()) validationErrors.title = 'validation.titleRequired';
    if (!form.message.trim()) validationErrors.message = 'validation.fieldRequired';
    if (form.targetRole === 'class' && !form.targetClassId)
      validationErrors.targetClassId = 'validation.selectClass';
    if (form.targetRole === 'branch' && !form.targetBranchId)
      validationErrors.targetBranchId = 'validation.fieldRequired';
    if (form.targetRole === 'user' && !form.userId)
      validationErrors.userId = 'validation.fieldRequired';
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }

    const scheduledAt =
      form.scheduleDate && form.scheduleTime
        ? new Date(`${form.scheduleDate}T${form.scheduleTime}:00`)
        : null;

    setBusy(true);
    try {
      const outcome = await send(
        {
          title: form.title,
          message: form.message,
          category: form.category,
          targetRole: form.targetRole,
          targetClassId: form.targetClassId || null,
          targetBranchId: form.targetBranchId || null,
          userId: form.userId || null,
          route: form.route.trim() || null,
          scheduledAt,
        },
        user
      );
      logEvent(AnalyticsEvents.notificationSent, { target: form.targetRole, kind: outcome.kind });
      setLastOutcome(outcome.note);
      toast.success(t('common.success'));
      setComposing(false);
      setForm(EMPTY);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!user || !cancelTarget) return;
    setBusy(true);
    try {
      await cancelScheduled(cancelTarget.id, user);
      toast.success(t('common.success'));
      setCancelTarget(null);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
      <View style={styles.toolbar}>
        <Text style={styles.title} accessibilityRole="header">
          {t('notification.title')}
        </Text>
        {can('SEND_NOTIFICATIONS') ? (
          <Button
            label={t('notification.send')}
            icon="send-outline"
            size="sm"
            onPress={() => {
              setForm(EMPTY);
              setErrors({});
              setComposing(true);
            }}
          />
        ) : null}
      </View>

      {lastOutcome ? (
        <Card style={styles.outcomeCard}>
          <View style={styles.outcomeRow}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.outcomeText}>{lastOutcome}</Text>
          </View>
        </Card>
      ) : null}

      <Spacer />

      <SectionHeader title={t('dashboard.recentActivity')} icon="time-outline" />

      <AsyncBoundary
        loading={loading}
        error={error}
        empty={(history ?? []).length === 0}
        onRetry={reload}
        skeleton={<SkeletonList count={5} />}
        emptyProps={{ icon: 'notifications-off-outline', title: t('notification.noNotifications') }}
      >
        <View style={{ gap: spacing.md }}>
          {(history ?? []).map((item) => (
            <Card key={item.id}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Badge
                  label={t(item.kind === 'scheduled' ? 'notification.scheduled' : 'notification.sent')}
                  tone={item.status}
                />
              </View>
              <Text style={styles.historyMessage} numberOfLines={3}>
                {truncate(item.message, 160)}
              </Text>
              <Text style={styles.historyMeta}>
                {t('notification.sendTo')}: {item.targetRole} ·{' '}
                {item.kind === 'scheduled'
                  ? `${t('notification.scheduleFor')} ${formatDateTime(item.scheduledAt, language)}`
                  : relativeTime(item.sentAt ?? item.createdAt, language)}
              </Text>
              {item.deliveryNote ? (
                <Text style={styles.historyNote}>{item.deliveryNote}</Text>
              ) : null}
              {item.status === 'scheduled' && can('SEND_NOTIFICATIONS') ? (
                <Button
                  label={t('common.cancel')}
                  icon="close-circle-outline"
                  variant="outline"
                  size="sm"
                  onPress={() => setCancelTarget(item)}
                  style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                />
              ) : null}
            </Card>
          ))}
        </View>
      </AsyncBoundary>

      <Spacer size={spacing.xxxl} />

      <FormSheet
        visible={composing}
        title={t('notification.send')}
        onClose={() => setComposing(false)}
        onSubmit={handleSend}
        submitting={busy}
        submitLabel={
          form.scheduleDate && form.scheduleTime ? t('notification.scheduled') : t('notification.sendNow')
        }
      >
        <TextField
          label={t('common.title')}
          value={form.title}
          onChangeText={(v) => set('title', v)}
          error={errors.title}
          icon="notifications-outline"
          required
        />
        <TextField
          label={t('notification.message')}
          value={form.message}
          onChangeText={(v) => set('message', v)}
          error={errors.message}
          multiline
          required
        />
        <Select<NotificationTarget>
          label={t('notification.sendTo')}
          value={form.targetRole}
          options={[
            { value: 'all', label: t('notification.targetAll') },
            { value: 'students', label: t('notification.targetStudents') },
            { value: 'teachers', label: t('notification.targetTeachers') },
            { value: 'class', label: t('notification.targetClass') },
            { value: 'branch', label: t('notification.targetBranch') },
            { value: 'user', label: t('notification.targetUser') },
          ]}
          onChange={(v) => set('targetRole', v)}
        />
        {form.targetRole === 'class' ? (
          <Select
            label={t('auth.class')}
            value={form.targetClassId}
            options={classOptions}
            onChange={(v) => set('targetClassId', v)}
            error={errors.targetClassId}
            required
          />
        ) : null}
        {form.targetRole === 'branch' ? (
          <Select
            label={t('auth.branch')}
            value={form.targetBranchId}
            options={branchOptions}
            onChange={(v) => set('targetBranchId', v)}
            error={errors.targetBranchId}
            required
          />
        ) : null}
        {form.targetRole === 'user' ? (
          <Select
            label={t('notification.targetUser')}
            value={form.userId}
            options={peopleOptions}
            onChange={(v) => set('userId', v)}
            error={errors.userId}
            searchable
            required
          />
        ) : null}

        <Select<NotificationCategory>
          label={t('notification.category')}
          value={form.category}
          options={[
            { value: 'general', label: t('notification.title') },
            { value: 'class_reminder', label: t('calendar.title') },
            { value: 'new_lesson', label: t('lesson.title') },
            { value: 'new_video', label: t('video.title') },
            { value: 'quiz_available', label: t('quiz.title') },
            { value: 'new_article', label: t('article.title') },
            { value: 'event_reminder', label: t('dashboard.upcomingEvent') },
            { value: 'announcement', label: t('announcement.title') },
          ]}
          onChange={(v) => set('category', v)}
        />

        <View style={styles.scheduleBlock}>
          <Text style={styles.scheduleLabel}>{t('notification.scheduleFor')}</Text>
          <View style={styles.scheduleRow}>
            <DateField
              value={form.scheduleDate}
              onChange={(v) => set('scheduleDate', v)}
              minimumDate={new Date()}
              containerStyle={{ flex: 1 }}
            />
            <TimeField
              value={form.scheduleTime}
              onChange={(v) => set('scheduleTime', v)}
              containerStyle={{ flex: 1 }}
            />
          </View>
          {form.scheduleDate && form.scheduleTime ? (
            <View style={styles.scheduleNote}>
              <Ionicons name="information-circle-outline" size={15} color={colors.warning} />
              <Text style={styles.scheduleNoteText}>{t('notification.scheduledNote')}</Text>
            </View>
          ) : (
            <Button
              label={toISODate() === form.scheduleDate ? t('common.clear') : t('common.clear')}
              variant="ghost"
              size="sm"
              onPress={() => {
                set('scheduleDate', '');
                set('scheduleTime', '');
              }}
              style={{ alignSelf: 'flex-start' }}
            />
          )}
        </View>
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(cancelTarget)}
        title={t('common.cancel')}
        message={cancelTarget?.title}
        confirmLabel={t('common.confirm')}
        destructive
        loading={busy}
        onCancel={() => setCancelTarget(null)}
        onConfirm={handleCancel}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  title: { flex: 1, fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  outcomeCard: { marginTop: spacing.lg, backgroundColor: colors.infoSoft },
  outcomeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  outcomeText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  historyTitle: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  historyMessage: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 19 },
  historyMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  historyNote: {
    fontSize: fontSize.xs,
    color: colors.slate,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  scheduleBlock: { marginTop: spacing.sm },
  scheduleLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  scheduleRow: { flexDirection: 'row', gap: spacing.md },
  scheduleNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  scheduleNoteText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
});
