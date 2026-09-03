import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { formatShortDate, formatTimeRange, toISODate } from '@/utils/date';
import { matchesSearch } from '@/utils/format';
import {
  deleteEvent,
  detectMeetingProvider,
  listPast,
  listUpcoming,
  saveEvent,
} from '@/services/calendarService';
import { listBranches, listClasses } from '@/services/orgService';
import type { AudienceRole, CalendarEvent, MeetingProvider } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { ChipGroup, DateField, Select, TextField, TimeField, type Option } from '@/components/ui';
import { ImageField } from '@/components/shared/ImageField';

interface EventForm {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  speaker: string;
  meetingProvider: MeetingProvider;
  meetingUrl: string;
  meetingId: string;
  meetingPasscode: string;
  logoUrl: string;
  bannerUrl: string;
  branchId: string;
  classId: string;
  targetAudience: AudienceRole;
  status: CalendarEvent['status'];
}

const EMPTY: EventForm = {
  title: '',
  description: '',
  date: toISODate(),
  startTime: '21:00',
  endTime: '22:00',
  venue: '',
  speaker: '',
  meetingProvider: 'other',
  meetingUrl: '',
  meetingId: '',
  meetingPasscode: '',
  logoUrl: '',
  bannerUrl: '',
  branchId: '',
  classId: '',
  targetAudience: 'all',
  status: 'scheduled',
};

export function CalendarManager({ classScope }: { classScope?: string[] }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const [mode, setMode] = useState<'upcoming' | 'past'>('upcoming');

  const loadOrg = useCallback(async () => {
    const [branches, classPage] = await Promise.all([
      listBranches().catch(() => []),
      listClasses({ pageSize: 100 }).catch(() => ({ items: [], cursor: null, hasMore: false })),
    ]);
    const classes = classScope
      ? classPage.items.filter((c) => classScope.includes(c.id))
      : classPage.items;
    return { branches, classes };
  }, [classScope]);

  const { data: org } = useAsync(loadOrg, [classScope?.join(',')]);

  const branchOptions = useMemo<Option[]>(
    () => (org?.branches ?? []).map((b) => ({ value: b.id, label: b.name, description: b.city })),
    [org?.branches]
  );
  const classOptions = useMemo<Option[]>(
    () => (org?.classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [org?.classes]
  );

  const fetchPage = useCallback(
    async (cursor: Cursor, search: string) => {
      const page =
        mode === 'upcoming'
          ? await listUpcoming({ cursor, pageSize: 20 })
          : await listPast({ cursor, pageSize: 20 });
      const scoped = classScope
        ? page.items.filter((e) => !e.classId || classScope.includes(e.classId))
        : page.items;
      return {
        ...page,
        items: search
          ? scoped.filter((e) => matchesSearch(search, e.title, e.venue, e.speaker))
          : scoped,
      };
    },
    [mode, classScope]
  );

  return (
    <CrudScreen<CalendarEvent, EventForm>
      title={t('calendar.title')}
      addLabel={t('calendar.addEvent')}
      emptyIcon="calendar-outline"
      emptyTitle={t('calendar.noEvents')}
      canCreate={can('MANAGE_CALENDAR')}
      canDelete={can('MANAGE_CALENDAR')}
      deps={[mode, classScope?.join(',')]}
      fetchPage={fetchPage}
      formTitle={{ create: t('calendar.addEvent'), edit: t('calendar.editEvent') }}
      filters={
        <ChipGroup<'upcoming' | 'past'>
          options={[
            { value: 'upcoming', label: t('calendar.upcoming') },
            { value: 'past', label: t('calendar.past') },
          ]}
          value={mode}
          onChange={setMode}
        />
      }
      emptyForm={EMPTY}
      toForm={(event) => ({
        title: event.title,
        description: event.description ?? '',
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        venue: event.venue ?? '',
        speaker: event.speaker ?? '',
        meetingProvider: event.meetingProvider ?? 'other',
        meetingUrl: event.meetingUrl ?? '',
        meetingId: event.meetingId ?? '',
        meetingPasscode: event.meetingPasscode ?? '',
        logoUrl: event.logoUrl ?? '',
        bannerUrl: event.bannerUrl ?? '',
        branchId: event.branchId ?? '',
        classId: event.classId ?? '',
        targetAudience: event.targetAudience,
        status: event.status,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.date) errors.date = 'validation.fieldRequired';
        if (!form.startTime) errors.startTime = 'validation.fieldRequired';
        if (!form.endTime) errors.endTime = 'validation.fieldRequired';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveEvent(
          {
            title: form.title.trim(),
            description: form.description.trim(),
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            venue: form.venue.trim(),
            speaker: form.speaker.trim(),
            meetingUrl: form.meetingUrl.trim() || null,
            meetingProvider: form.meetingProvider,
            meetingId: form.meetingId.trim() || null,
            meetingPasscode: form.meetingPasscode.trim() || null,
            // Copied onto the event, so a published class keeps the identity it
            // was announced with even if the defaults change later.
            logoUrl: form.logoUrl.trim() || null,
            bannerUrl: form.bannerUrl.trim() || null,
            branchId: form.branchId || null,
            classId: form.classId || null,
            targetAudience: form.targetAudience,
            status: form.status,
            teacherId: user.role === 'teacher' ? user.uid : (existing?.teacherId ?? null),
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (event) => {
        if (!user) return;
        await deleteEvent(event.id, user);
      }}
      renderItem={(event, actions) => (
        <AdminRow
          icon="calendar-outline"
          title={event.title}
          subtitle={event.venue || event.speaker || undefined}
          meta={`${formatShortDate(event.date)} · ${formatTimeRange(event.startTime, event.endTime)}`}
          badges={[
            { label: t(`calendar.audience${event.targetAudience === 'all' ? 'All' : event.targetAudience === 'students' ? 'Students' : 'Teachers'}`) },
            ...(event.status !== 'scheduled'
              ? [{ label: t(`calendar.event${event.status === 'cancelled' ? 'Cancelled' : 'Completed'}`), tone: event.status }]
              : []),
          ]}
          onEdit={can('MANAGE_CALENDAR') ? actions.edit : undefined}
          onDelete={can('MANAGE_CALENDAR') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('calendar.eventTitle')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="calendar-outline"
            required
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
          />
          <DateField
            label={t('common.date')}
            value={form.date}
            onChange={(v) => set('date', v)}
            error={errors.date}
            required
          />
          <TimeField
            label={t('calendar.startTime')}
            value={form.startTime}
            onChange={(v) => set('startTime', v)}
            error={errors.startTime}
            required
          />
          <TimeField
            label={t('calendar.endTime')}
            value={form.endTime}
            onChange={(v) => set('endTime', v)}
            error={errors.endTime}
            required
          />
          <TextField
            label={t('calendar.venue')}
            value={form.venue}
            onChangeText={(v) => set('venue', v)}
            icon="location-outline"
          />
          <TextField
            label={t('calendar.speaker')}
            value={form.speaker}
            onChangeText={(v) => set('speaker', v)}
            icon="mic-outline"
          />
          <TextField
            label={t('calendar.meetingUrl')}
            value={form.meetingUrl}
            onChangeText={(v) => {
              set('meetingUrl', v);
              // Recognise the platform from the link so it is one less field to
              // fill in; still overridable below.
              if (v.trim()) set('meetingProvider', detectMeetingProvider(v));
            }}
            icon="videocam-outline"
            autoCapitalize="none"
            hint="Paste a Zoom or Google Meet link"
          />

          {form.meetingUrl.trim() ? (
            <>
              <Select<MeetingProvider>
                label={t('calendar.meetingProvider')}
                value={form.meetingProvider}
                options={[
                  { value: 'zoom', label: t('calendar.zoom'), icon: 'videocam-outline' },
                  { value: 'meet', label: t('calendar.googleMeet'), icon: 'videocam-outline' },
                  { value: 'other', label: t('calendar.otherPlatform'), icon: 'link-outline' },
                ]}
                onChange={(v) => set('meetingProvider', v)}
              />
              <TextField
                label={t('calendar.meetingId')}
                value={form.meetingId}
                onChangeText={(v) => set('meetingId', v)}
                icon="key-outline"
                autoCapitalize="none"
              />
              <TextField
                label={t('calendar.meetingPasscode')}
                value={form.meetingPasscode}
                onChangeText={(v) => set('meetingPasscode', v)}
                icon="lock-closed-outline"
                autoCapitalize="none"
              />
            </>
          ) : null}

          <ImageField
            label={t('calendar.logo')}
            value={form.logoUrl}
            onChange={(url) => set('logoUrl', url)}
            hint={t('calendar.brandingHint')}
            aspectRatio={1}
          />

          <ImageField
            label={t('calendar.banner')}
            value={form.bannerUrl}
            onChange={(url) => set('bannerUrl', url)}
            aspectRatio={3}
          />
          <Select
            label={t('auth.branch')}
            value={form.branchId}
            options={branchOptions}
            onChange={(v) => set('branchId', v)}
            placeholder={t('common.all')}
            allowClear
          />
          <Select
            label={t('auth.class')}
            value={form.classId}
            options={classOptions}
            onChange={(v) => set('classId', v)}
            placeholder={t('common.all')}
            allowClear
          />
          <Select<AudienceRole>
            label={t('calendar.targetAudience')}
            value={form.targetAudience}
            options={[
              { value: 'all', label: t('calendar.audienceAll') },
              { value: 'students', label: t('calendar.audienceStudents') },
              { value: 'teachers', label: t('calendar.audienceTeachers') },
            ]}
            onChange={(v) => set('targetAudience', v)}
          />
          <Select<CalendarEvent['status']>
            label={t('common.status')}
            value={form.status}
            options={[
              { value: 'scheduled', label: t('common.active') },
              { value: 'completed', label: t('calendar.eventCompleted') },
              { value: 'cancelled', label: t('calendar.eventCancelled') },
            ]}
            onChange={(v) => set('status', v)}
          />
        </>
      )}
    />
  );
}
