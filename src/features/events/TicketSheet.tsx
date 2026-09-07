import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as bookings from '@/services/eventRegistrationService';
import type { CalendarEvent, EventRegistration } from '@/types';
import { FormSheet } from '@/components/ui';

/**
 * The ticket, once an admin has confirmed the booking.
 *
 * Shaped like a paper ticket on purpose — a stub above a perforation, the code
 * large enough to read across a table, the names underneath. Somebody is going
 * to hold a phone up at a door in bad light, and the thing being checked is the
 * code and the headcount, so those are what the layout gives room to.
 *
 * A pending booking gets no ticket at all. Showing a greyed-out one would
 * suggest the place is held pending a formality, when in fact the organiser has
 * not yet agreed.
 */
export function TicketSheet({
  registration,
  event,
  visible,
  onClose,
}: {
  registration: EventRegistration | null;
  event: CalendarEvent | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!registration) return null;

  const code = bookings.ticketCode(registration.id);
  const paid = registration.paid === true;

  return (
    <FormSheet
      visible={visible}
      title={t('event.ticket')}
      onClose={onClose}
      // No submit: a ticket is something to look at, not a form to send.
      submitLabel={t('common.close')}
      onSubmit={onClose}
    >
      <View style={styles.ticket}>
        <View style={styles.stub}>
          <Ionicons name="ticket" size={18} color={colors.surface} />
          <Text style={styles.stubText}>{t('event.ticketConfirmed')}</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.eventTitle}>{registration.eventTitle}</Text>

          {event ? (
            <>
              <Fact icon="calendar-outline" text={`${event.date}  ·  ${event.startTime}`} />
              {event.venue || event.location ? (
                <Fact
                  icon="location-outline"
                  text={[event.venue, event.location].filter(Boolean).join(', ')}
                />
              ) : null}
            </>
          ) : null}

          {/* The perforation. Above it, what the event is; below it, what the
              holder must be able to prove. */}
          <View style={styles.perforation} />

          {/* The code, twice: once for a camera and once for a person.
              A scanner is faster and cannot mis-read a G as a 6, but a phone
              with a cracked screen or a flat battery still has to get in, so
              the printed code stays exactly as prominent as it was. */}
          <View style={styles.qrFrame}>
            <QRCode
              value={code}
              size={QR_SIZE}
              // Black on white, not the brand colours. This is read by a
              // camera in whatever light the doorway has, and contrast is the
              // one thing that decides whether that works.
              color="#000000"
              backgroundColor="#FFFFFF"
              // Highest error correction. Six characters fit in the smallest
              // symbol either way, so the redundancy is free, and it buys a
              // scan through glare, a thumb over a corner or a scuffed screen.
              ecl="H"
              // The quiet margin is part of the symbol: without it a scanner
              // cannot find the edges against the card.
              quietZone={QR_QUIET_ZONE}
            />
          </View>
          <Text style={styles.qrHint}>{t('event.ticketScan')}</Text>

          <Text style={styles.codeLabel}>{t('event.ticketCode')}</Text>
          <Text style={styles.code} selectable>
            {code}
          </Text>

          <View style={styles.counts}>
            <View style={styles.count}>
              <Text style={styles.countValue}>{registration.seats}</Text>
              <Text style={styles.countLabel}>{t('event.totalSeats')}</Text>
            </View>
            <View style={styles.count}>
              <Text style={styles.countValue}>
                {registration.amount} {registration.currency}
              </Text>
              <Text style={styles.countLabel}>{t('event.totalFee')}</Text>
            </View>
            <View style={styles.count}>
              <Text style={[styles.countValue, paid ? styles.paid : styles.unpaid]}>
                {t(paid ? 'event.paidYes' : 'event.paidNo')}
              </Text>
              <Text style={styles.countLabel}>{t('event.payment')}</Text>
            </View>
          </View>

          {registration.reference ? (
            <Fact icon="card-outline" text={registration.reference} />
          ) : null}

          {/* Everyone admitted on this ticket. The door needs the list, not the
              number — a family arriving one at a time is checked off by name. */}
          <Text style={styles.holdersLabel}>{t('event.ticketHolders')}</Text>
          {registration.participants?.map((person, index) => (
            <View key={`${person.name}-${index}`} style={styles.holder}>
              <Text style={styles.holderIndex}>{index + 1}</Text>
              <Text style={styles.holderName} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={styles.holderBand}>{t(`event.age_${person.ageGroup}`)}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.note}>{t('event.ticketNote')}</Text>
    </FormSheet>
  );
}

function Fact({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={13} color={colors.textSecondary} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

/** Big enough to scan from across a table, small enough to leave the ticket a ticket. */
const QR_SIZE = 132;
const QR_QUIET_ZONE = 10;

const styles = StyleSheet.create({
  ticket: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stubText: {
    color: colors.surface,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  body: { padding: spacing.md },
  eventTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  factText: { fontSize: fontSize.xs, color: colors.textSecondary, flex: 1 },
  perforation: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginVertical: spacing.md,
  },
  qrFrame: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    // No padding: the quiet zone the QR draws for itself is the margin, and
    // adding a second one only makes the symbol smaller for no gain.
    marginBottom: 2,
  },
  qrHint: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  codeLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    letterSpacing: 1,
  },
  code: {
    fontSize: 34,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    textAlign: 'center',
    // Wide tracking, because this gets read aloud and typed in by hand.
    letterSpacing: 6,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  counts: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  count: { flex: 1, alignItems: 'center' },
  countValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  countLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  paid: { color: colors.success },
  unpaid: { color: colors.warning },
  holdersLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  holder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  holderIndex: {
    fontSize: 10,
    color: colors.textMuted,
    width: 16,
    textAlign: 'center',
  },
  holderName: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  holderBand: { fontSize: fontSize.xs, color: colors.textSecondary },
  note: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
