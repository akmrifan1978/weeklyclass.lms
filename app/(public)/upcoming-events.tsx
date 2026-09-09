import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import {
  bookingLabelKey,
  Fact,
  ListState,
  PublicCard,
  SearchBar,
  SignInPrompt,
  Tag,
} from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { listPublicClasses, type PublicClass } from '@/services/calendarService';
import { formatShortDate } from '@/utils/date';
import { brand, colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { tone } from '@/components/public/tone';

/**
 * What is coming up, for anybody at all.
 *
 * Reads the thin public copy of the schedule — the same documents the front
 * page advertises from — so no meeting link, no class id and no attendee count
 * is anywhere near this screen.
 *
 * Nothing here books a place. An event that takes bookings says so and stops
 * there, because the seat count, the price and a person's own eligibility are
 * all things only a signed-in session can answer.
 */
export default function PublicEvents() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const load = useCallback(() => listPublicClasses(40), []);
  const { data, loading, refreshing, refresh } = useAsync(load, []);

  const events = useMemo(() => {
    const rows = data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((event) =>
      [event.title, event.description, event.venue, event.location, event.speaker]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [data, query]);

  return (
    <PublicPage
      badge={t('public.events.badge')}
      title={t('dashboard.upcomingClasses')}
      subtitle={t('public.events.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <SearchBar value={query} onChange={setQuery} placeholder={t('public.events.search')} />

      <ListState
        loading={loading}
        empty={events.length === 0}
        icon="calendar-outline"
        title={t('public.events.emptyTitle')}
        message={t('public.events.emptyBody')}
      />

      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}

      {events.length > 0 ? <SignInPrompt message={t('public.events.bookNote')} /> : null}
    </PublicPage>
  );
}

function EventCard({ event }: { event: PublicClass }) {
  const { t } = useTranslation();
  const where = [event.venue, event.location].filter(Boolean).join(', ');
  const booking = bookingLabelKey(event);

  return (
    <PublicCard>
      <View style={styles.head}>
        <Tag label={formatShortDate(event.date)} tone="muted" />
        {booking ? <Tag label={t(booking)} /> : null}
      </View>

      <Text style={styles.title}>{event.title}</Text>

      {event.startTime ? (
        <Fact
          icon="time-outline"
          text={`${event.startTime}${event.endTime ? ` – ${event.endTime}` : ''}`}
          tint={brand.orange}
        />
      ) : null}
      {where ? <Fact icon="location-outline" text={where} /> : null}
      {event.speaker ? <Fact icon="person-outline" text={event.speaker} /> : null}

      {event.description ? (
        <Text style={styles.blurb} numberOfLines={4}>
          {event.description}
        </Text>
      ) : null}
    </PublicCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: tone.title,
    lineHeight: 23,
  },
  blurb: {
    fontSize: fontSize.sm,
    color: tone.body,
    lineHeight: 19,
    marginTop: 2,
  },
});
