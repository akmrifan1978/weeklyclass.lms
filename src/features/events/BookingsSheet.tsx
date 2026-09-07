import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { saveTextFile, safeFilename } from '@/utils/download';
import * as bookings from '@/services/eventRegistrationService';
import type { CalendarEvent, EventRegistration } from '@/types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FormSheet,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * The organiser's side of the door: every booking for one event.
 *
 * A booking arrives pending and waits here for a decision. Confirming it is
 * what produces the holder's ticket, so this screen is the only place that
 * grants one — which is why the two actions are given equal weight rather than
 * hiding cancel behind a menu. An organiser turning people away is doing
 * something as ordinary as letting them in.
 */
export function BookingsSheet({
  event,
  visible,
  onClose,
  onChanged,
}: {
  event: CalendarEvent | null;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<EventRegistration | null>(null);
  const [rejecting, setRejecting] = useState<EventRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!event) return [] as EventRegistration[];
    const page = await bookings.listRegistrations({ eventId: event.id, pageSize: 500 });
    return page.items;
  }, [event?.id]);

  const { data, loading, error, reload } = useAsync(load, [load]);
  const rows = data ?? [];

  /** Runs one admin action, then refreshes both this list and the card behind it. */
  const run = async (row: EventRegistration, action: () => Promise<void>) => {
    setBusyId(row.id);
    try {
      await action();
      await reload();
      // The event card shows a seat count that a cancellation changes.
      onChanged();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusyId(null);
    }
  };

  const exportSheet = async () => {
    if (rows.length === 0) {
      toast.error(t('event.noAttendees'));
      return;
    }
    try {
      await saveTextFile(
        safeFilename(`${event?.title ?? 'event'}-attendees`, 'csv'),
        bookings.toCsv(rows)
      );
      toast.success(t('event.exported', { count: rows.length }));
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  const pending = rows.filter((r) => r.status === 'pending').length;

  return (
    <>
      <FormSheet visible={visible} title={t('event.bookings')} onClose={onClose}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {event?.title}
          </Text>
          <Button
            label={t('event.exportExcel')}
            icon="download-outline"
            size="sm"
            variant="outline"
            onPress={() => void exportSheet()}
          />
        </View>

        {pending > 0 ? (
          <Text style={styles.pendingBanner}>{t('event.pendingCount', { count: pending })}</Text>
        ) : null}

        {loading ? (
          <SkeletonList count={2} />
        ) : error ? (
          <Text style={styles.error}>{friendlyMessage(error, t)}</Text>
        ) : rows.length === 0 ? (
          <EmptyState icon="people-outline" title={t('event.noAttendees')} />
        ) : (
          rows.map((row) => (
            <View key={row.id} style={styles.row}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {row.userName}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[row.userMobile, row.reference].filter(Boolean).join('  ·  ')}
                  </Text>
                </View>
                <View style={styles.codeBox}>
                  <Text style={styles.code}>{bookings.ticketCode(row.id)}</Text>
                </View>
              </View>

              <View style={styles.chips}>
                <Chip
                  label={t(`event.bookingStatus_${row.status}`)}
                  tone={
                    row.status === 'confirmed'
                      ? 'success'
                      : row.status === 'cancelled' || row.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                />
                <Chip label={t('event.seatsCount', { count: row.seats })} tone="muted" />
                <Chip label={`${row.amount} ${row.currency}`} tone="muted" />
                <Chip
                  label={t(row.paid ? 'event.paidYes' : 'event.paidNo')}
                  tone={row.paid ? 'success' : 'muted'}
                />
              </View>

              {/* Who is actually coming. An organiser confirming a booking for
                  six is agreeing to six named people, not to a number. */}
              <Text style={styles.people} numberOfLines={3}>
                {row.participants
                  ?.map((p) => `${p.name} (${t(`event.age_${p.ageGroup}`)})`)
                  .join(', ')}
              </Text>

              <View style={styles.actions}>
                {row.status !== 'confirmed' && row.status !== 'cancelled' ? (
                  <Button
                    label={t('event.confirmBookingAction')}
                    icon="checkmark-circle-outline"
                    size="sm"
                    loading={busyId === row.id}
                    onPress={() =>
                      void run(row, async () => {
                        await bookings.confirmBooking(row, user!);
                        toast.success(t('event.confirmed'));
                      })
                    }
                  />
                ) : null}

                {/* Declining is offered only for a request that is still open.
                    A confirmed booking is taken back by cancelling, which
                    releases the seat; declining it would leave the seat held. */}
                {row.status === 'pending' ? (
                  <Button
                    label={t('event.rejectBooking')}
                    icon="close-circle-outline"
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      setRejectReason('');
                      setRejecting(row);
                    }}
                  />
                ) : null}

                {row.status !== 'cancelled' && row.status !== 'rejected' ? (
                  <>
                    <Button
                      label={t(row.paid ? 'event.markUnpaid' : 'event.markPaid')}
                      icon="cash-outline"
                      size="sm"
                      variant="outline"
                      onPress={() =>
                        void run(row, () => bookings.setPaid(row, !row.paid, user!))
                      }
                    />
                    <Button
                      label={t('event.cancelBooking')}
                      icon="close-circle-outline"
                      size="sm"
                      variant="ghost"
                      onPress={() => setConfirmCancel(row)}
                    />
                  </>
                ) : null}
              </View>
            </View>
          ))
        )}
      </FormSheet>

      <FormSheet
        visible={Boolean(rejecting)}
        title={t('event.rejectBooking')}
        onClose={() => setRejecting(null)}
        submitLabel={t('event.rejectBooking')}
        submitting={busyId === rejecting?.id}
        onSubmit={async () => {
          const row = rejecting;
          if (!row || !user) return;
          await run(row, async () => {
            await bookings.rejectBooking(row, user, rejectReason);
            toast.success(t('event.rejected'));
          });
          setRejecting(null);
        }}
      >
        <TextField
          label={t('event.rejectReason')}
          value={rejectReason}
          onChangeText={setRejectReason}
          multiline
          hint={t('event.rejectReasonHint')}
          containerStyle={{ marginBottom: 0 }}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmCancel)}
        title={t('event.cancelBooking')}
        message={t('event.cancelWarning', {
          name: confirmCancel?.userName ?? '',
          count: confirmCancel?.seats ?? 0,
        })}
        confirmLabel={t('event.cancelBooking')}
        destructive
        loading={busyId === confirmCancel?.id}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={async () => {
          const row = confirmCancel;
          if (!row || !user) return;
          await run(row, async () => {
            await bookings.cancel(row, user);
            toast.success(t('event.cancelled'));
          });
          setConfirmCancel(null);
        }}
      />
    </>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'danger' | 'warning' | 'muted';
}) {
  const palette = {
    success: { bg: colors.successSoft, fg: colors.success },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    muted: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  }[tone];

  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Text style={[styles.chipText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  pendingBanner: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.md,
  },
  error: { fontSize: fontSize.sm, color: colors.danger, marginBottom: spacing.md },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  codeBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  code: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    letterSpacing: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chip: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: fontWeight.semibold },
  people: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
