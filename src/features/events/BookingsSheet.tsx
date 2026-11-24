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
  const { user, isAdmin } = useAuth();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<EventRegistration | null>(null);
  const [rejecting, setRejecting] = useState<EventRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [partPaying, setPartPaying] = useState<EventRegistration | null>(null);
  const [partAmount, setPartAmount] = useState('');
  const [refunding, setRefunding] = useState<EventRegistration | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmDeleteOne, setConfirmDeleteOne] = useState<EventRegistration | null>(null);

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
          {/* Admin only, matching the rule the database enforces, and never
              offered on an empty list — there is nothing to delete, and a
              destructive button with nothing to destroy is just a trap. */}
          {isAdmin && rows.length > 0 ? (
            <Button
              label={t('event.deleteAll')}
              icon="trash-outline"
              size="sm"
              variant="ghost"
              onPress={() => setConfirmDeleteAll(true)}
            />
          ) : null}
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
                {/* What has actually been received, which is no longer a yes
                    or a no: a deposit says how much and what is left, and a
                    refund says money went back out. */}
                <Chip
                  label={paymentLabel(row, t)}
                  tone={
                    bookings.paymentStateOf(row) === 'paid'
                      ? 'success'
                      : bookings.paymentStateOf(row) === 'refunded'
                        ? 'danger'
                        : bookings.paymentStateOf(row) === 'partial'
                          ? 'warning'
                          : 'muted'
                  }
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
                {/* Approve holds the seats and asks for the money. What turns
                    an approved booking into a ticket is Mark paid, below. */}
                {row.status === 'pending' ? (
                  <Button
                    label={t('event.approveBooking')}
                    icon="checkmark-circle-outline"
                    size="sm"
                    loading={busyId === row.id}
                    onPress={() =>
                      void run(row, async () => {
                        await bookings.confirmBooking(row, user!);
                        toast.success(t(Number(row.amount) > 0 ? 'event.approved' : 'event.confirmed'));
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
                    {/* Paid in full, approved, and still not a ticket.
                        This state should no longer be reachable — approving a
                        booking already paid for now confirms it outright — but
                        bookings that reached it before the fix are stuck in a
                        corner with no way out, since Approve is offered only
                        for a pending booking. One press settles it, and the
                        button is its own explanation of what is wrong. */}
                    {row.status === 'awaitingPayment' && bookings.outstandingOn(row) <= 0 ? (
                      <Button
                        label={t('event.issueTicket')}
                        icon="ticket-outline"
                        size="sm"
                        loading={busyId === row.id}
                        onPress={() =>
                          void run(row, async () => {
                            await bookings.setPaidAmount(row, Number(row.amount) || 0, user!);
                            toast.success(t('event.ticketReady'));
                          })
                        }
                      />
                    ) : null}
                    <Button
                      label={t(row.paid ? 'event.markUnpaid' : 'event.markPaid')}
                      icon="cash-outline"
                      size="sm"
                      variant="outline"
                      onPress={() =>
                        void run(row, async () => {
                          await bookings.setPaid(row, !row.paid, user!);
                          if (!row.paid) toast.success(t('event.ticketReady'));
                        })
                      }
                    />
                    {/* Part payment, for the deposit people actually pay.
                        Offered only where there is a bill to pay part of. */}
                    {Number(row.amount) > 0 ? (
                      <Button
                        label={t('event.partPayment')}
                        icon="wallet-outline"
                        size="sm"
                        variant="outline"
                        onPress={() => {
                          setPartAmount(String(bookings.receivedOn(row) || ''));
                          setPartPaying(row);
                        }}
                      />
                    ) : null}
                    <Button
                      label={t('event.cancelBooking')}
                      icon="close-circle-outline"
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        /* A cancellation with money in hand is a refund
                           decision, not a yes-or-no: the amount is asked for
                           in its own sheet, prefilled with everything taken.
                           With nothing received there is nothing to decide. */
                        const held = bookings.netReceivedOn(row);
                        if (held > 0) {
                          setRefundAmount(String(held));
                          setRefunding(row);
                        } else {
                          setConfirmCancel(row);
                        }
                      }}
                    />
                  </>
                ) : null}

                {/* Outside the block above on purpose: a cancelled or declined
                    booking has no other button on its row, and that was the
                    one state somebody most wants to clear away. Admin only,
                    which is what the database enforces too. */}
                {isAdmin ? (
                  <Button
                    label={t('common.delete')}
                    icon="trash-outline"
                    size="sm"
                    variant="ghost"
                    onPress={() => setConfirmDeleteOne(row)}
                  />
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

      {/* Recording part of the money.
          The total and what is already in are both on screen, because the
          question "how much came in" is usually answered by looking at what
          is still owed. */}
      <FormSheet
        visible={Boolean(partPaying)}
        title={t('event.partPayment')}
        onClose={() => setPartPaying(null)}
        submitLabel={t('common.save')}
        submitting={busyId === partPaying?.id}
        onSubmit={async () => {
          const row = partPaying;
          if (!row || !user) return;
          const typed = Number(partAmount);
          if (!Number.isFinite(typed) || typed < 0) {
            toast.error(t('event.amountInvalid'));
            return;
          }
          await run(row, async () => {
            await bookings.setPaidAmount(row, typed, user);
            toast.success(
              typed >= Number(row.amount) ? t('event.ticketReady') : t('event.partPaymentSaved')
            );
          });
          setPartPaying(null);
        }}
      >
        <Text style={styles.sheetFact}>
          {t('event.partPaymentHelp', {
            total: `${partPaying?.amount ?? 0} ${partPaying?.currency ?? ''}`,
            received: `${partPaying ? bookings.receivedOn(partPaying) : 0} ${partPaying?.currency ?? ''}`,
          })}
        </Text>
        <TextField
          label={`${t('event.amountReceived')} (${partPaying?.currency ?? ''})`}
          value={partAmount}
          onChangeText={(v) => setPartAmount(v.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          icon="cash-outline"
          hint={t('event.partPaymentHint')}
          containerStyle={{ marginBottom: 0 }}
        />
      </FormSheet>

      {/* Cancelling a booking that has been paid for.
          The refund is recorded in the same action as the cancellation — the
          rules refuse to touch a cancelled booking afterwards — so this is the
          one moment the amount can be set. Typing 0 cancels and keeps the
          money, which is a legitimate answer for a late withdrawal. */}
      <FormSheet
        visible={Boolean(refunding)}
        title={t('event.refundAndCancel')}
        onClose={() => setRefunding(null)}
        submitLabel={t('event.refundAndCancel')}
        submitting={busyId === refunding?.id}
        onSubmit={async () => {
          const row = refunding;
          if (!row || !user) return;
          const typed = Number(refundAmount);
          if (!Number.isFinite(typed) || typed < 0) {
            toast.error(t('event.amountInvalid'));
            return;
          }
          await run(row, async () => {
            await bookings.cancel(row, user, typed);
            toast.success(typed > 0 ? t('event.refunded', { amount: typed }) : t('event.cancelled'));
          });
          setRefunding(null);
        }}
      >
        <Text style={styles.sheetFact}>
          {t('event.refundHelp', {
            name: refunding?.userName ?? '',
            held: `${refunding ? bookings.netReceivedOn(refunding) : 0} ${refunding?.currency ?? ''}`,
          })}
        </Text>
        <TextField
          label={`${t('event.refundAmount')} (${refunding?.currency ?? ''})`}
          value={refundAmount}
          onChangeText={(v) => setRefundAmount(v.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          icon="arrow-undo-outline"
          hint={t('event.refundHint')}
          containerStyle={{ marginBottom: 0 }}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDeleteOne)}
        title={t('common.delete')}
        message={t('event.deleteOneWarning', {
          name: confirmDeleteOne?.userName ?? '',
          count: confirmDeleteOne?.seats ?? 0,
        })}
        confirmLabel={t('common.delete')}
        destructive
        loading={busyId === confirmDeleteOne?.id}
        onCancel={() => setConfirmDeleteOne(null)}
        onConfirm={async () => {
          const row = confirmDeleteOne;
          if (!row || !user) return;
          await run(row, async () => {
            await bookings.deleteBooking(row, user);
            toast.success(t('event.deleteOneDone'));
          });
          setConfirmDeleteOne(null);
        }}
      />

      {/* The warning names the number and the money, because "are you sure"
          is not information. An event's accounts are built from its bookings,
          so this erases what attendees paid as well as who was coming. */}
      <ConfirmDialog
        visible={confirmDeleteAll}
        title={t('event.deleteAll')}
        message={t('event.deleteAllWarning', {
          count: rows.length,
          received: `${rows.reduce((sum, r) => sum + bookings.netReceivedOn(r), 0)} ${
            rows[0]?.currency ?? ''
          }`,
        })}
        confirmLabel={t('event.deleteAll')}
        destructive
        loading={deletingAll}
        onCancel={() => setConfirmDeleteAll(false)}
        onConfirm={async () => {
          if (!event || !user) return;
          setDeletingAll(true);
          try {
            const removed = await bookings.deleteAllForEvent(event, user);
            toast.success(t('event.deleteAllDone', { count: removed }));
            await reload();
            onChanged();
          } catch (err) {
            toast.error(friendlyMessage(err, t));
          } finally {
            setDeletingAll(false);
            setConfirmDeleteAll(false);
          }
        }}
      />

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

/**
 * The payment chip's wording, which is the whole state in a few characters.
 *
 * "Paid" and "Not paid" no longer cover it: a deposit has to say how much of
 * how much, or an organiser reading the list cannot tell a half-paid family
 * from an unpaid one.
 */
function paymentLabel(
  row: EventRegistration,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const state = bookings.paymentStateOf(row);
  if (state === 'paid') return t('event.paidYes');
  if (state === 'unpaid') return t('event.paidNo');
  if (state === 'refunded') {
    return t('event.refundedChip', { amount: bookings.refundedOn(row), currency: row.currency });
  }
  return t('event.partPaidChip', {
    received: bookings.receivedOn(row),
    total: row.amount,
    currency: row.currency,
  });
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
  sheetFact: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
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
