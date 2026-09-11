import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { combineDateTime, formatShortDate, formatTimeRange, toISODate } from '@/utils/date';
import { matchesSearch } from '@/utils/format';
import {
  deleteEvent,
  detectMeetingProvider,
  listPast,
  listUpcoming,
  saveEvent,
} from '@/services/calendarService';
import { listBranches, listClasses } from '@/services/orgService';
import { getSettings, watchSettings } from '@/services/settingsService';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { whatsappGroupLink } from '@/utils/validation';
import type {
  AudienceRole,
  CalendarEvent,
  MeetingProvider,
  AgeGroup,
  RegistrationStatus,
} from '@/types';
import { AGE_GROUPS } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import {
  ChipGroup,
  DateField,
  Select,
  TextField,
  TimeField,
  ToggleRow,
  type Option,
} from '@/components/ui';
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

  // Registration. Off by default: most calendar entries are a class reminder,
  // not a ticketed event, and defaulting to "takes bookings" would put a Book
  // button on every lesson.
  takesBookings: boolean;
  registrationStatus: RegistrationStatus;
  capacity: string;
  price: string;
  currency: string;

  // Per-age-group pricing. Off by default: one price for everybody is the
  // common case, and four boxes on every event would be four chances to leave
  // one blank.
  bandedPricing: boolean;
  prices: Record<AgeGroup, string>;
  referenceLabel: string;
  whatsappLink: string;
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
  takesBookings: false,
  registrationStatus: 'openingSoon',
  capacity: '',
  price: '',
  currency: 'SAR',
  bandedPricing: false,
  prices: { infant: '', child: '', teenage: '', adult: '' },
  referenceLabel: '',
  whatsappLink: '',
};

/** True once the moment an event starts has already gone by. */
function isPast(date: string, startTime: string): boolean {
  if (!date || !startTime) return false;
  return combineDateTime(date, startTime).getTime() < Date.now();
}

export function CalendarManager({ classScope }: { classScope?: string[] }) {
  // Built here rather than in a module-scope StyleSheet: this file had none
  // before, and reading theme tokens while the module is still initialising is
  // the one moment they are not reliably there.
  const PRESET_ROW = {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    marginBottom: spacing.md,
  };
  const PRESET_CHIP = {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  };
  const PRESET_TEXT = {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  };

  const PAST_NOTICE = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  };
  const PAST_NOTICE_TEXT = {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text,
    lineHeight: 17,
  };

  const [eventNames, setEventNames] = useState<string[]>([]);

  useEffect(() => {
    return watchSettings((settings) => setEventNames(settings.eventNames ?? []));
  }, []);
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

  // New classes start from the organisation's branding, then keep their own
  // copy — the same rule recordings follow.
  const loadBranding = useCallback(async () => {
    const settings = await getSettings().catch(() => null);
    return { logoUrl: settings?.logoUrl ?? '', bannerUrl: settings?.bannerUrl ?? '' };
  }, []);

  const { data: branding } = useAsync(loadBranding, []);

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
      emptyForm={{
        ...EMPTY,
        logoUrl: branding?.logoUrl ?? '',
        bannerUrl: branding?.bannerUrl ?? '',
      }}
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

        takesBookings: Boolean(event.registration),

        registrationStatus: event.registration?.status ?? 'openingSoon',

        capacity:

          event.registration?.capacity != null

            ? String(event.registration.capacity)

            : '',

        price: event.registration?.price ? String(event.registration.price) : '',

        currency: event.registration?.currency ?? 'SAR',
        bandedPricing: Boolean(event.registration?.pricesByAgeGroup),
        prices: bandsToForm(event.registration?.pricesByAgeGroup),
        referenceLabel: event.registration?.referenceLabel ?? '',
        whatsappLink: event.registration?.whatsappLink ?? '',
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
            // `null` rather than an empty object when bookings are off, so the
            // Events screen can tell a ticketed event from a class reminder by
            // the presence of the field alone.
            registration: form.takesBookings
              ? {
                  status: form.registrationStatus,
                  // Empty means no limit, which is different from a limit of
                  // zero — one accepts everybody, the other nobody.
                  capacity: form.capacity.trim() ? Number(form.capacity) : null,
                  price: Number(form.price) || 0,
                  currency: form.currency.trim() || 'SAR',
                  // Undefined rather than an empty map when banded pricing is
                  // off, so `priceFor` falls straight through to the base price
                  // instead of reading four zeroes as "free for everyone".
                  pricesByAgeGroup: form.bandedPricing
                    ? bandsFromForm(form.prices)
                    : undefined,
                  referenceLabel: form.referenceLabel.trim() || null,
                  whatsappLink: whatsappGroupLink(form.whatsappLink).link,
                }
              : undefined,
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
          {/* Presets, not a dropdown replacing the field. A recurring event is
              tapped once and still editable afterwards, which a Select would
              take away from the one-off events that share this form. */}
          {eventNames.length > 0 ? (
            <View style={PRESET_ROW}>
              {eventNames.map((name) => (
                <Pressable
                  key={name}
                  onPress={() => set('title', name)}
                  style={PRESET_CHIP}
                  accessibilityRole="button"
                >
                  <Text style={PRESET_TEXT} numberOfLines={1}>
                    {name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
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

          {/*
            An event whose start has already passed is saved happily and then
            filed under Past, which from the other side of the screen looks
            exactly like the save having failed — so it is said out loud here,
            while the date is still on screen and still changeable.

            A warning rather than an error, because backdating is legitimate:
            a class that happened last week still belongs on the calendar.
          */}
          {isPast(form.date, form.startTime) ? (
            <View style={PAST_NOTICE}>
              <Ionicons name="time-outline" size={16} color={colors.warning} />
              <Text style={PAST_NOTICE_TEXT}>{t('calendar.startsInThePast')}</Text>
            </View>
          ) : null}
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
            hint={t('calendar.meetingLinkHint')}
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
          {/*
            Registration turns a calendar entry into a bookable event. Kept in
            one block rather than scattered among the scheduling fields, because
            an organiser either is taking bookings or is not.
          */}
          <ToggleRow
            label={t('event.enableRegistration')}
            value={form.takesBookings}
            onValueChange={(v) => set('takesBookings', v)}
          />

          {form.takesBookings ? (
            <>
              <Select<RegistrationStatus>
                label={t('event.statusLabel')}
                value={form.registrationStatus}
                options={[
                  { value: 'openingSoon', label: t('event.status_openingSoon') },
                  { value: 'open', label: t('event.status_open') },
                  { value: 'closed', label: t('event.status_closed') },
                ]}
                onChange={(v) => set('registrationStatus', v)}
                required
              />
              <TextField
                label={t('event.capacity')}
                value={form.capacity}
                onChangeText={(v) => set('capacity', v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                icon="people-outline"
                hint={t('event.capacityHint')}
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TextField
                  label={t('event.price')}
                  value={form.price}
                  onChangeText={(v) => set('price', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  icon="pricetag-outline"
                  hint={t('event.priceHint')}
                  containerStyle={{ flex: 2 }}
                />
                <TextField
                  label={t('event.currency')}
                  value={form.currency}
                  onChangeText={(v) => set('currency', v.toUpperCase().slice(0, 5))}
                  autoCapitalize="characters"
                  containerStyle={{ flex: 1 }}
                />
              </View>

              {/*
                A different price per age band. Children and infants usually pay
                less or nothing, and an organiser who cannot say so here ends up
                collecting the difference by hand at the door.
              */}
              <ToggleRow
                label={t('event.bandedPricing')}
                description={t('event.bandedPricingHint')}
                value={form.bandedPricing}
                onValueChange={(v) => set('bandedPricing', v)}
              />

              {form.bandedPricing ? (
                <View style={{ gap: 0 }}>
                  {AGE_GROUPS.map((group) => (
                    <TextField
                      key={group}
                      label={t(`event.age_${group}`)}
                      value={form.prices[group]}
                      onChangeText={(v) =>
                        set('prices', {
                          ...form.prices,
                          [group]: v.replace(/[^0-9.]/g, ''),
                        })
                      }
                      keyboardType="decimal-pad"
                      icon="pricetag-outline"
                      // Blank means "same as the base price", which is how an
                      // organiser sets only the infant price without having to
                      // retype the other three.
                      placeholder={form.price || '0'}
                    />
                  ))}
                </View>
              ) : null}

              <TextField
                label={t('event.referenceLabelField')}
                value={form.referenceLabel}
                onChangeText={(v) => set('referenceLabel', v)}
                icon="card-outline"
                hint={t('event.referenceLabelHint')}
              />

              {/* Handed to people who book, and to nobody else. Left empty, no
                  WhatsApp appears anywhere — on the ticket, in the confirmation
                  or in the booking details. */}
              <TextField
                label={t('event.whatsappLink')}
                value={form.whatsappLink}
                onChangeText={(v) => set('whatsappLink', v)}
                icon="logo-whatsapp"
                autoCapitalize="none"
                keyboardType="url"
                placeholder="https://chat.whatsapp.com/..."
                hint={t('event.whatsappLinkHint')}
                error={
                  whatsappGroupLink(form.whatsappLink).invalid
                    ? t('event.whatsappLinkInvalid')
                    : undefined
                }
              />
            </>
          ) : null}

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

/** The saved per-band prices as form strings; blank where no band price is set. */
function bandsToForm(
  bands: Partial<Record<AgeGroup, number>> | undefined
): Record<AgeGroup, string> {
  const out = {} as Record<AgeGroup, string>;
  for (const group of AGE_GROUPS) {
    const value = bands?.[group];
    out[group] = typeof value === 'number' ? String(value) : '';
  }
  return out;
}

/**
 * The form strings back as prices, dropping the blanks.
 *
 * A blank band is left out of the map entirely rather than stored as 0, because
 * `priceFor` treats a missing band as "charge the base price" — storing a zero
 * would let everyone in that band in free.
 */
function bandsFromForm(prices: Record<AgeGroup, string>): Partial<Record<AgeGroup, number>> {
  const out: Partial<Record<AgeGroup, number>> = {};
  for (const group of AGE_GROUPS) {
    const raw = prices[group]?.trim();
    if (raw) out[group] = Number(raw) || 0;
  }
  return out;
}
