import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as calendar from '@/services/calendarService';
import { listClasses } from '@/services/orgService';
import { getSettings } from '@/services/settingsService';
import { announce } from '@/services/announceService';
import { ImageField } from '@/components/shared/ImageField';
import type { CalendarEvent, ClassRoom } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  FormSheet,
  IconButton,
  Screen,
  SectionHeader,
  Select,
  SkeletonList,
  TextField,
  type Option,
} from '@/components/ui';

/**
 * Scheduling online classes.
 *
 * Each session is tied to a class, and several may run at the same hour — a
 * beginners' session and an adults' session in parallel is the normal case here.
 * Nothing checks for a clash, deliberately: two sessions at 6pm for different
 * classes is the intended arrangement, not a mistake to warn about.
 *
 * Branding is copied onto the session at save time rather than read from
 * settings when it is displayed, so changing the platform logo later never
 * restyles a session that has already been announced.
 */
export function ScheduleOnlineClassScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const blank = {
    title: '',
    description: '',
    date: '',
    startTime: '',
    endTime: '',
    classId: '',
    speaker: '',
    meetingUrl: '',
    meetingId: '',
    meetingPasscode: '',
    logoUrl: '',
    bannerUrl: '',
  };
  const [form, setForm] = useState({ ...blank });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [sessions, classes, settings] = await Promise.all([
      calendar.listOnlineClasses(),
      listClasses({ pageSize: 100 })
        .then((page) => page.items)
        .catch(() => [] as ClassRoom[]),
      getSettings(),
    ]);
    return { sessions, classes, settings };
  }, []);

  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const classOptions = useMemo<Option[]>(
    () =>
      (data?.classes ?? []).map((room) => ({
        value: room.id,
        label: room.name,
        description: room.schedule,
      })),
    [data?.classes]
  );

  const classNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const room of data?.classes ?? []) map[room.id] = room.name;
    return map;
  }, [data?.classes]);

  const open = (event: CalendarEvent | null) => {
    setEditing(event);
    setCreating(!event);
    setErrors({});
    setForm(
      event
        ? {
            title: event.title,
            description: event.description ?? '',
            date: event.date,
            startTime: event.startTime,
            endTime: event.endTime,
            classId: event.classId ?? '',
            speaker: event.speaker ?? '',
            meetingUrl: event.meetingUrl ?? '',
            meetingId: event.meetingId ?? '',
            meetingPasscode: event.meetingPasscode ?? '',
            logoUrl: event.logoUrl ?? '',
            bannerUrl: event.bannerUrl ?? '',
          }
        : {
            ...blank,
            // New sessions start from the platform branding; published ones keep
            // whatever they were announced with.
            logoUrl: data?.settings.logoUrl ?? '',
            bannerUrl: data?.settings.bannerUrl ?? '',
          }
    );
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = 'validation.fieldRequired';
    if (!form.date) next.date = 'validation.fieldRequired';
    if (!/^\d{2}:\d{2}$/.test(form.startTime)) next.startTime = 'onlineClass.timeFormat';
    if (!/^\d{2}:\d{2}$/.test(form.endTime)) next.endTime = 'onlineClass.timeFormat';
    if (!form.meetingUrl.trim()) next.meetingUrl = 'onlineClass.linkRequired';
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      next.endTime = 'onlineClass.endBeforeStart';
    }
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    if (!user) return;
    setBusy(true);
    try {
      const url = form.meetingUrl.trim();
      await calendar.saveEvent(
        {
          title: form.title.trim(),
          description: form.description.trim(),
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          classId: form.classId || null,
          speaker: form.speaker.trim(),
          meetingUrl: url,
          meetingProvider: calendar.detectMeetingProvider(url),
          meetingId: form.meetingId.trim() || null,
          meetingPasscode: form.meetingPasscode.trim() || null,
          logoUrl: form.logoUrl || null,
          bannerUrl: form.bannerUrl || null,
          targetAudience: 'all',
        },
        user,
        editing?.id
      );

      void announce(
        {
          kind: 'onlineClass',
          title: `${form.title.trim()} — ${form.date} ${form.startTime}`,
          classId: form.classId || null,
          isUpdate: Boolean(editing),
        },
        user
      );

      toast.success(t('common.success'));
      close();
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete || !user) return;
    setBusy(true);
    try {
      await calendar.deleteEvent(confirmDelete.id, user);
      toast.success(t('common.success'));
      setConfirmDelete(null);
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppHeader
        title={t('onlineClass.schedule')}
        showBack
        right={
          <IconButton
            icon="add"
            label={t('onlineClass.newSession')}
            color={colors.textInverse}
            background="rgba(255,255,255,0.14)"
            onPress={() => open(null)}
          />
        }
      />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Card style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.noticeText}>{t('onlineClass.parallelNote')}</Text>
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
        ) : (data?.sessions.length ?? 0) === 0 ? (
          <EmptyState
            icon="videocam-outline"
            title={t('onlineClass.noneScheduled')}
            message={t('onlineClass.noneScheduledHelp')}
            actionLabel={t('onlineClass.newSession')}
            onAction={() => open(null)}
          />
        ) : (
          <>
            <SectionHeader title={t('onlineClass.upcoming')} icon="videocam-outline" />
            {data?.sessions.map((event) => (
              <Card key={event.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {event.date} · {event.startTime}–{event.endTime}
                    {event.classId ? ` · ${classNames[event.classId] ?? ''}` : ''}
                  </Text>
                  <Text style={styles.rowUrl} numberOfLines={1}>
                    {event.meetingUrl}
                  </Text>
                </View>
                <IconButton
                  icon="create-outline"
                  label={t('common.edit')}
                  size={34}
                  color={colors.primary}
                  onPress={() => open(event)}
                />
                <IconButton
                  icon="trash-outline"
                  label={t('common.delete')}
                  size={34}
                  color={colors.danger}
                  background={colors.dangerSoft}
                  onPress={() => setConfirmDelete(event)}
                />
              </Card>
            ))}
          </>
        )}
      </Screen>

      <FormSheet
        visible={creating || Boolean(editing)}
        title={editing ? t('onlineClass.editSession') : t('onlineClass.newSession')}
        onClose={close}
        onSubmit={submit}
        submitting={busy}
      >
        <TextField
          label={t('onlineClass.sessionTitle')}
          value={form.title}
          onChangeText={(v) => setForm((p) => ({ ...p, title: v }))}
          error={errors.title}
          icon="videocam-outline"
          required
        />

        <Select
          label={t('auth.class')}
          value={form.classId}
          options={classOptions}
          onChange={(v) => setForm((p) => ({ ...p, classId: v }))}
          placeholder={t('onlineClass.allClasses')}
          allowClear
        />

        <DateField
          label={t('calendar.date')}
          value={form.date}
          onChange={(v) => setForm((p) => ({ ...p, date: v }))}
          error={errors.date}
          required
        />

        <View style={styles.timeRow}>
          <TextField
            label={t('calendar.startTime')}
            value={form.startTime}
            onChangeText={(v) => setForm((p) => ({ ...p, startTime: v }))}
            error={errors.startTime}
            placeholder="18:00"
            icon="time-outline"
            containerStyle={{ flex: 1 }}
            required
          />
          <TextField
            label={t('calendar.endTime')}
            value={form.endTime}
            onChangeText={(v) => setForm((p) => ({ ...p, endTime: v }))}
            error={errors.endTime}
            placeholder="19:30"
            icon="time-outline"
            containerStyle={{ flex: 1 }}
            required
          />
        </View>

        <TextField
          label={t('onlineClass.meetingLink')}
          value={form.meetingUrl}
          onChangeText={(v) => setForm((p) => ({ ...p, meetingUrl: v }))}
          error={errors.meetingUrl}
          hint={t('onlineClass.meetingLinkHint')}
          icon="link-outline"
          autoCapitalize="none"
          required
        />
        <TextField
          label={t('onlineClass.meetingId')}
          value={form.meetingId}
          onChangeText={(v) => setForm((p) => ({ ...p, meetingId: v }))}
          autoCapitalize="none"
        />
        <TextField
          label={t('onlineClass.passcode')}
          value={form.meetingPasscode}
          onChangeText={(v) => setForm((p) => ({ ...p, meetingPasscode: v }))}
          autoCapitalize="none"
        />

        <TextField
          label={t('video.speaker')}
          value={form.speaker}
          onChangeText={(v) => setForm((p) => ({ ...p, speaker: v }))}
          icon="person-outline"
        />
        <TextField
          label={t('common.description')}
          value={form.description}
          onChangeText={(v) => setForm((p) => ({ ...p, description: v }))}
          multiline
        />

        <ImageField
          label={t('settings.logo')}
          value={form.logoUrl}
          onChange={(v) => setForm((p) => ({ ...p, logoUrl: v }))}
          kind="branding"
        />
        <ImageField
          label={t('settings.banner')}
          value={form.bannerUrl}
          onChange={(v) => setForm((p) => ({ ...p, bannerUrl: v }))}
          kind="branding"
          aspectRatio={3}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('confirm.deleteTitle')}
        message={confirmDelete?.title}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={remove}
      />
    </>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  rowText: { flex: 1 },
  rowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  rowUrl: { fontSize: fontSize.xs, color: brand.orange, marginTop: 1 },
  timeRow: { flexDirection: 'row', gap: spacing.md },
});
