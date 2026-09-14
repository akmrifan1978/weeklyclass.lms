import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { saveTextFile, safeFilename } from '@/utils/download';
import * as calendar from '@/services/calendarService';
import * as bookings from '@/services/eventRegistrationService';
import type { CalendarEvent, EventRegistration } from '@/types';
import { EventCard } from './EventCard';
import { BookingSheet, type PartyMember } from './BookingSheet';
import { BookingsSheet } from './BookingsSheet';
import { TicketSheet } from './TicketSheet';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonList,
} from '@/components/ui';
import { GuestEventsList } from './GuestEventsList';

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
  const { user, can, isGuest } = useAuth();

  const isOrganiser = can('MANAGE_CALENDAR');

  const [booking, setBooking] = useState<CalendarEvent | null>(null);
  const [manage, setManage] = useState<CalendarEvent | null>(null);
  const [ticket, setTicket] = useState<EventRegistration | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // A guest is shown the public schedule instead — see GuestEventsList. The
    // full events would be refused, and they carry the meeting links that
    // list deliberately leaves out.
    if (isGuest) return { events: [] as CalendarEvent[], mine: [] as EventRegistration[] };
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
  }, [user?.uid, isGuest]);

  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  // A cancelled booking is not "mine" any more — it must leave the Book button
  // in place so the person can try again.
  const myBookingFor = (event: CalendarEvent) =>
    data?.mine.find((m) => m.eventId === event.id && m.status !== 'cancelled') ?? null;

  const submitBooking = async (party: PartyMember[], reference: string) => {
    if (!booking || !user) return;
    setBusy(true);
    try {
      await bookings.book(booking, party, user, reference);
      toast.success(t('event.booked'));
      setBooking(null);
      void reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Every participant of every event, in one sheet.
   *
   * Per-event lists live inside each event's bookings sheet. This is the other
   * question an organiser asks — who is coming to anything at all — and it is
   * one file rather than one download per event, which is what makes it worth
   * having separately.
   *
   * Written as CSV, which Excel opens natively: a real .xlsx would need a
   * spreadsheet library and a megabyte of bundle to produce a file that opens
   * exactly the same way.
   */
  const exportEveryone = async () => {
    try {
      const rows = await bookings
        .listRegistrations({ pageSize: 1000 })
        .then((p) => p.items);

      if (rows.length === 0) {
        toast.error(t('event.noAttendees'));
        return;
      }

      await saveTextFile(
        safeFilename(`all-participants-${new Date().toISOString().slice(0, 10)}`, 'csv'),
        bookings.toCsv(rows)
      );
      toast.success(t('event.exported', { count: rows.length }));
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  if (isGuest) return <GuestEventsList />;

  return (
    <>
      <AppHeader title={t('nav.events')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {/* The whole-list export sits above the events rather than on any one
            of them, because it is not about any one of them. */}
        {isOrganiser && (data?.events.length ?? 0) > 0 ? (
          <View style={styles.toolbar}>
            <Button
              label={t('event.exportAll')}
              icon="albums-outline"
              size="sm"
              variant="outline"
              onPress={() => void exportEveryone()}
            />
          </View>
        ) : null}

        {loading ? (
          <SkeletonList count={2} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
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
            const waitlist = bookings.wouldWaitlist(event);

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
                          label={t('event.bookings')}
                          icon="people-outline"
                          size="sm"
                          onPress={() => setManage(event)}
                        />
                      </>
                    ) : mine ? (
                      // Confirmed means there is a ticket to show. Pending means
                      // the organiser has not decided yet, and saying so plainly
                      // is better than a button that opens a half-ticket.
                      mine.status === 'confirmed' ? (
                        <Button
                          label={t('event.viewTicket')}
                          icon="ticket-outline"
                          size="sm"
                          onPress={() => setTicket(mine)}
                        />
                      ) : mine.status === 'rejected' ? (
                        <Text style={styles.blocked}>
                          {mine.rejectionReason || t('event.bookingRejected')}
                        </Text>
                      ) : (
                        <Text style={styles.awaiting}>
                          {t('event.awaitingDecision', { seats: mine.seats })}
                        </Text>
                      )
                    ) : blocked ? (
                      <Text style={styles.blocked}>{t(blocked)}</Text>
                    ) : (
                      // A full event still takes requests. The button says which
                      // it is, because "Book" on a full event promises a seat
                      // that does not exist.
                      <Button
                        label={t(waitlist ? 'event.waitlistBook' : 'event.book')}
                        icon={waitlist ? 'hourglass-outline' : 'ticket-outline'}
                        variant={waitlist ? 'outline' : 'primary'}
                        size="sm"
                        onPress={() => setBooking(event)}
                      />
                    )}
                  </>
                }
              />
            );
          })
        )}
      </Screen>

      {/* Keyed on the event so the party list starts empty each time rather
          than carrying the previous event's family into the next one. */}
      <BookingSheet
        key={booking?.id ?? 'none'}
        event={booking}
        visible={Boolean(booking)}
        submitting={busy}
        onClose={() => setBooking(null)}
        onConfirm={submitBooking}
      />

      <BookingsSheet
        key={manage?.id ?? 'no-manage'}
        event={manage}
        visible={Boolean(manage)}
        onClose={() => setManage(null)}
        onChanged={() => void reload()}
      />

      <TicketSheet
        registration={ticket}
        event={data?.events.find((e) => e.id === ticket?.eventId) ?? null}
        visible={Boolean(ticket)}
        onClose={() => setTicket(null)}
      />

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
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.md },
  booked: { fontSize: fontSize.sm, color: colors.success, fontWeight: '600' },
  awaiting: { fontSize: fontSize.sm, color: colors.warning, fontWeight: '600' },
  blocked: { fontSize: fontSize.sm, color: colors.textMuted },
  total: { fontSize: fontSize.md, color: colors.text, fontWeight: '700', marginBottom: spacing.md },
  payNote: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 16 },
});
