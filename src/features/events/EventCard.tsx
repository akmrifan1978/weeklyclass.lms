import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as registrations from '@/services/eventRegistrationService';
import type { CalendarEvent } from '@/types';
import { Button } from '@/components/ui';

/**
 * One event, as a poster.
 *
 * The banner leads because an event is announced visually, and the facts a
 * person actually decides on — when, where, how many seats are left, what it
 * costs — sit together on one line beneath the description rather than being
 * spread down the card. Someone deciding whether to come reads that line and
 * nothing else.
 *
 * Seats read "12/100" rather than "88 left". A near-empty event and a nearly
 * full one look different at a glance that way, and both facts are there.
 */
export function EventCard({
  event,
  actions,
}: {
  event: CalendarEvent;
  /** Admin controls. Absent for someone who is only attending. */
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const registration = event.registration;
  const remaining = registrations.seatsRemaining(event);
  const full = registrations.isFull(event);

  // One colour, two jobs: it fills the dot and tints the text. Handing the same
  // style to both painted the label green on green and swallowed it, so the
  // colour is carried as a value and applied to the right property each time.
  const statusColor =
    registration?.status === 'open'
      ? full
        ? colors.danger
        : colors.success
      : registration?.status === 'closed'
        ? colors.textMuted
        : colors.warning;

  return (
    <View style={styles.card}>
      {event.bannerUrl ? (
        <Image
          source={{ uri: event.bannerUrl }}
          style={styles.banner}
          resizeMode="cover"
          accessibilityLabel={event.title}
        />
      ) : null}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
          {registration ? (
            <View style={registration.price > 0 ? styles.paidChip : styles.freeChip}>
              <Text style={registration.price > 0 ? styles.paidText : styles.freeText}>
                {t(registration.price > 0 ? 'event.paid' : 'event.free')}
              </Text>
            </View>
          ) : null}
        </View>

        {registration ? (
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>
              {t(
                full && registration.status === 'open'
                  ? 'event.statusFull'
                  : `event.status_${registration.status}`
              )}
            </Text>
            <Text style={styles.statusNote}>
              {registration.note?.trim() ||
                t(
                  full && registration.status === 'open'
                    ? 'event.statusFullNote'
                    : `event.statusNote_${registration.status}`
                )}
            </Text>
          </View>
        ) : null}

        {event.description ? (
          <Text style={styles.description}>{event.description}</Text>
        ) : null}

        {/* The decision line: when, where, how many seats, what it costs. */}
        <View style={styles.factRow}>
          <Fact icon="calendar-outline" text={formatDate(event.date)} />
          <Fact icon="time-outline" text={event.startTime} />
          {event.venue || event.location ? (
            <Fact
              icon="location-outline"
              text={[event.venue, event.location].filter(Boolean).join(', ')}
            />
          ) : null}
          {registration?.capacity != null ? (
            <Fact
              icon="people-outline"
              text={`${event.registeredCount ?? 0}/${registration.capacity}`}
              tone={full ? colors.danger : undefined}
            />
          ) : registration ? (
            <Fact icon="people-outline" text={String(event.registeredCount ?? 0)} />
          ) : null}
          {registration && registration.price > 0 ? (
            <Fact
              icon="pricetag-outline"
              text={t('event.pricePerPerson', {
                price: registration.price,
                currency: registration.currency,
              })}
            />
          ) : null}
        </View>

        {remaining !== null && remaining > 0 && remaining <= 10 ? (
          <Text style={styles.lowSeats}>{t('event.seatsLeft', { count: remaining })}</Text>
        ) : null}

        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

function Fact({
  icon,
  text,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  tone?: string;
}) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={12} color={tone ?? colors.textSecondary} />
      <Text style={[styles.factText, tone ? { color: tone } : null]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** `YYYY-MM-DD` shown as `DD/MM/YYYY`, which is how these dates are read here. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  banner: { width: '100%', height: 150, backgroundColor: colors.surfaceMuted },
  body: { padding: spacing.lg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  paidChip: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  paidText: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.bold },
  freeChip: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  freeText: { fontSize: fontSize.xs, color: colors.success, fontWeight: fontWeight.bold },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statusNote: { fontSize: fontSize.xs, color: colors.textMuted, marginLeft: spacing.sm },
  description: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  factRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  factText: { fontSize: fontSize.xs, color: colors.textSecondary },
  lowSeats: {
    fontSize: fontSize.xs,
    color: colors.danger,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
