import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as calendar from '@/services/calendarService';
import * as bookings from '@/services/eventRegistrationService';
import type { CalendarEvent, EventRegistration } from '@/types';
import { EventCard } from './EventCard';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  FormSheet,
  Screen,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * Events, with booking.
 *
 * One screen for everybody, differing only in what it offers: an organiser gets
 * Edit, Delete and the attendee export; everyone else gets a Book button, or
 * the reason there isn't one. Two screens would have meant two places to change
 * the card every time an event gained a field.
 */
export function EventsScreen({ basePath }: { basePath: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, can } = useAuth();

  const isOrganiser = can('MANAGE_CALENDAR');

  const [booking, setBooking] = useState<CalendarEvent | null>(null);
  const [seats, setSeats] = useState('1');
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const page = await calendar.listUpcoming({ pageSize: 50 });
    // Only events that actually take bookings. A class reminder lives in the
    // same collection and has no business on a page about tickets.
    const events = page.items.filter((event) => Boolean(event.registration));

    const mine = user
      ? await bookings
          .listRegistrations({ userId: user.uid, pageSize: 100 })
          .then((p) => p.items)
          .catch(() => [] as EventRegistration[])
      : [];

    return { events, mine };
  }, [user?.uid]);

  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const myBookingFor = (event: CalendarEvent) =>
    data?.mine.find((m) => m.eventId === event.id && m.status === 'booked') ?? null;

  const submitBooking = async () => {
    if (!booking || !user) return;
    setBusy(true);
    try {
      await bookings.book(booking, Number(seats) || 1, user);
      toast.success(t('event.booked'));
      setBooking(null);
      setSeats('1');
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Downloads the attendee list.
   *
   * Written as CSV, which Excel opens natively — a real .xlsx would need a
   * spreadsheet library and a megabyte of bundle to produce a file that opens
   * exactly the same way.
   */
  const exportAttendees = async (event: CalendarEvent) => {
    try {
      const rows = await bookings
        .listRegistrations({ eventId: event.id, pageSize: 500 })
        .then((p) => p.items);

      if (rows.length === 0) {
        toast.error(t('event.noAttendees'));
        return;
      }

      const csv = bookings.toCsv(rows);
      const filename = `${event.title.replace(/[^\w؀-ۿ-]+/g, '-')}-attendees.csv`;

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        // No file picker on a phone without another dependency; sharing puts it
        // wherever the person actually wants it, which is usually WhatsApp.
        const { File, Paths } = await import('expo-file-system');
        const Sharing = await import('expo-sharing');
        const file = new File(Paths.cache, filename);
        // Rewritten each time rather than appended to: an export is a snapshot
        // of the list now, not an accumulating log.
        if (file.exists) file.delete();
        file.create();
        file.write(csv);
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
      }

      toast.success(t('event.exported', { count: rows.length }));
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  return (
    <>
      <AppHeader title={t('nav.events')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {loading ? (
          <SkeletonList count={2} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : (data?.events.length ?? 0) === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title={t('event.none')}
            message={t('event.noneHelp')}
          />
        ) : (
          data?.events.map((event) => {
            const mine = myBookingFor(event);
            const blocked = bookings.bookingBlockedReason(event, mine);

            return (
              <EventCard
                key={event.id}
                event={event}
                actions={
                  <>
                    {isOrganiser ? (
                      <>
                        <Button
                          label={t('common.edit')}
                          icon="create-outline"
                          size="sm"
                          variant="outline"
                          onPress={() =>
                            // Editing lives on the calendar screen, which
                            // already has the full form; duplicating it here
                            // would mean two forms to keep in step.
                            void import('expo-router').then(({ router }) =>
                              router.push(`${basePath}/calendar` as never)
                            )
                          }
                        />
                        <Button
                          label={t('common.delete')}
                          icon="trash-outline"
                          size="sm"
                          variant="ghost"
                          onPress={() => setConfirmDelete(event)}
                        />
                        <Button
                          label={t('event.exportExcel')}
                          icon="download-outline"
                          size="sm"
                          onPress={() => void exportAttendees(event)}
                        />
                      </>
                    ) : mine ? (
                      <Text style={styles.booked}>
                        {t('event.yourBooking', { seats: mine.seats })}
                      </Text>
                    ) : blocked ? (
                      <Text style={styles.blocked}>{t(blocked)}</Text>
                    ) : (
                      <Button
                        label={t('event.book')}
                        icon="ticket-outline"
                        size="sm"
                        onPress={() => {
                          setBooking(event);
                          setSeats('1');
                        }}
                      />
                    )}
                  </>
                }
              />
            );
          })
        )}
      </Screen>

      <FormSheet
        visible={Boolean(booking)}
        title={booking?.title ?? t('event.book')}
        onClose={() => setBooking(null)}
        onSubmit={submitBooking}
        submitting={busy}
      >
        <TextField
          label={t('event.seats')}
          value={seats}
          onChangeText={(v) => setSeats(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          icon="people-outline"
          hint={t('event.seatsHint')}
          required
        />
        {booking?.registration && booking.registration.price > 0 ? (
          <Text style={styles.total}>
            {t('event.totalDue', {
              amount: (Number(seats) || 0) * booking.registration.price,
              currency: booking.registration.currency,
            })}
          </Text>
        ) : null}
        <Text style={styles.payNote}>{t('event.payNote')}</Text>
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('confirm.deleteTitle')}
        message={t('event.deleteWarning', {
          count: confirmDelete?.registeredCount ?? 0,
        })}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete || !user) return;
          setBusy(true);
          try {
            await calendar.deleteEvent(confirmDelete.id, user);
            setConfirmDelete(null);
            void reload();
          } catch (err) {
            toast.error(friendlyMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  booked: { fontSize: fontSize.sm, color: colors.success, fontWeight: '600' },
  blocked: { fontSize: fontSize.sm, color: colors.textMuted },
  total: { fontSize: fontSize.md, color: colors.text, fontWeight: '700', marginBottom: spacing.md },
  payNote: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 16 },
});
