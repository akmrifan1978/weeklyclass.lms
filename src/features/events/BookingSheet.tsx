import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as bookings from '@/services/eventRegistrationService';
import { AGE_GROUPS, type AgeGroup, type CalendarEvent, type Gender } from '@/types';
import {
  Button,
  FormSheet,
  IconButton,
  Select,
  TextField,
  type Option,
} from '@/components/ui';

/**
 * Booking a place, for a party rather than a person.
 *
 * A family books together here, and the organiser needs the names — they are
 * chartering a bus or laying tables, and a headcount cannot be turned back into
 * a list. So the booker is shown as the first participant and the rest are added
 * beneath, each with the age band that decides their price.
 *
 * The total updates as rows are added, because "what will this cost me" is the
 * question someone is actually asking while they fill it in, and answering it
 * only after they commit is answering it too late.
 */

export interface PartyMember {
  name: string;
  gender: Gender;
  ageGroup: AgeGroup;
}

export function BookingSheet({
  event,
  visible,
  submitting,
  onClose,
  onConfirm,
}: {
  event: CalendarEvent | null;
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (party: PartyMember[], reference: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [selfAge, setSelfAge] = useState<AgeGroup>('adult');
  const [family, setFamily] = useState<PartyMember[]>([]);
  const [reference, setReference] = useState('');

  const settings = event?.registration;

  const ageOptions = useMemo<Option<AgeGroup>[]>(
    () => AGE_GROUPS.map((g) => ({ value: g, label: t(`event.age_${g}`) })),
    [t]
  );
  const genderOptions = useMemo<Option<Gender>[]>(
    () => [
      { value: 'male', label: t('auth.male') },
      { value: 'female', label: t('auth.female') },
    ],
    [t]
  );

  // The booker is always the first participant; the family rows follow.
  const party: PartyMember[] = [
    { name: user?.fullName ?? '', gender: (user?.gender as Gender) ?? 'male', ageGroup: selfAge },
    ...family,
  ];
  const named = party.filter((p) => p.name.trim().length > 0);
  const total = settings ? bookings.quote(settings, named) : 0;

  const priceLabel = (group: AgeGroup) =>
    settings ? `${bookings.priceFor(settings, group)} ${settings.currency}` : '';

  return (
    <FormSheet
      visible={visible}
      title={t('event.registration')}
      onClose={onClose}
      onSubmit={() => onConfirm(party, reference)}
      submitting={submitting}
      submitLabel={t('event.confirmBooking')}
    >
      {event ? (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>{event.title}</Text>
          <View style={styles.summaryRow}>
            <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.summaryFact}>{event.date}</Text>
            <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.summaryFact}>{event.startTime}</Text>
          </View>
          {event.venue || event.location ? (
            <View style={styles.summaryRow}>
              <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.summaryFact}>
                {[event.venue, event.location].filter(Boolean).join(', ')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* The booker. Their name comes from their profile and is not editable
          here — a booking is made by an account, and letting the name be typed
          over would let one person book under another's. */}
      {/* Said before the form rather than after the button. Somebody filling in
          six names deserves to know at the top that this is a request. */}
      {event && bookings.isFull(event) ? (
        <Text style={styles.waitlist}>{t('event.waitlistNotice')}</Text>
      ) : null}

      <Text style={styles.label}>{t('event.mainParticipant')}</Text>
      <View style={styles.selfRow}>
        <Text style={styles.selfName} numberOfLines={1}>
          {user?.fullName}
        </Text>
        <Select<AgeGroup>
          value={selfAge}
          options={ageOptions}
          onChange={setSelfAge}
          containerStyle={{ flex: 1, marginBottom: 0 }}
        />
      </View>

      {settings?.referenceLabel ? (
        <TextField
          label={settings.referenceLabel}
          value={reference}
          onChangeText={setReference}
          icon="card-outline"
          hint={t('event.referenceOptional')}
        />
      ) : null}

      <View style={styles.familyHeader}>
        <Text style={styles.label}>{t('event.familyMembers')}</Text>
        <Button
          label={t('common.add')}
          icon="add"
          size="sm"
          onPress={() =>
            setFamily((rows) => [...rows, { name: '', gender: 'male', ageGroup: 'adult' }])
          }
        />
      </View>

      {family.length === 0 ? (
        <Text style={styles.familyHint}>{t('event.familyHint')}</Text>
      ) : null}

      {family.map((member, index) => (
        <View key={index} style={styles.memberRow}>
          <TextField
            value={member.name}
            onChangeText={(v) =>
              setFamily((rows) =>
                rows.map((r, i) => (i === index ? { ...r, name: v } : r))
              )
            }
            placeholder={t('auth.fullName')}
            containerStyle={{ flex: 2, marginBottom: 0 }}
          />
          <Select<Gender>
            value={member.gender}
            options={genderOptions}
            onChange={(v) =>
              setFamily((rows) =>
                rows.map((r, i) => (i === index ? { ...r, gender: v } : r))
              )
            }
            containerStyle={{ flex: 1, marginBottom: 0 }}
          />
          <Select<AgeGroup>
            value={member.ageGroup}
            options={ageOptions}
            onChange={(v) =>
              setFamily((rows) =>
                rows.map((r, i) => (i === index ? { ...r, ageGroup: v } : r))
              )
            }
            containerStyle={{ flex: 1, marginBottom: 0 }}
          />
          <IconButton
            icon="trash-outline"
            label={t('common.delete')}
            size={34}
            color={colors.danger}
            background={colors.dangerSoft}
            onPress={() => setFamily((rows) => rows.filter((_, i) => i !== index))}
          />
        </View>
      ))}

      {/* What each band costs, shown only when they actually differ — an event
          with one price for everyone does not need a price table. */}
      {settings && hasBandedPrices(settings) ? (
        <View style={styles.priceTable}>
          {AGE_GROUPS.map((group) => (
            <View key={group} style={styles.priceLine}>
              <Text style={styles.priceGroup}>{t(`event.age_${group}`)}</Text>
              <Text style={styles.priceValue}>{priceLabel(group)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t('event.totalSeats')}</Text>
        <Text style={styles.totalSeats}>{named.length}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t('event.totalFee')}</Text>
        <Text style={styles.totalFee}>
          {total} {settings?.currency ?? ''}
        </Text>
      </View>

      <Text style={styles.payNote}>{t('event.payNote')}</Text>
    </FormSheet>
  );
}

/** True when the organiser has set a price that differs between bands. */
function hasBandedPrices(settings: NonNullable<CalendarEvent['registration']>): boolean {
  const prices = AGE_GROUPS.map((g) => bookings.priceFor(settings, g));
  return new Set(prices).size > 1;
}

const styles = StyleSheet.create({
  waitlist: {
    fontSize: fontSize.xs,
    color: colors.warning,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  summary: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  summaryFact: { fontSize: fontSize.xs, color: colors.textSecondary, marginRight: spacing.sm },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  selfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  selfName: { flex: 2, fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  familyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  familyHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  priceTable: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  priceLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  priceGroup: { fontSize: fontSize.xs, color: colors.textSecondary },
  priceValue: { fontSize: fontSize.xs, color: colors.text, fontWeight: fontWeight.semibold },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  totalLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  totalSeats: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },
  totalFee: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.success },
  payNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: spacing.md,
  },
});
