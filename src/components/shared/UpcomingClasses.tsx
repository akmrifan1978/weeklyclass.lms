import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import type { CalendarEvent } from '@/types';
import { SectionHeader } from '@/components/ui';

/**
 * The next few classes, with their photographs, on the screen everybody lands
 * on.
 *
 * The dashboard already named the single next event in a text card. That
 * answers "when", and the thing people actually respond to is "what" — a
 * photograph of the hall, the speaker, the poster somebody designed. So these
 * are cards with the image the organiser already uploads on the calendar form,
 * side by side, and the one at the front is the one happening soonest.
 *
 * Nothing here is a second kind of record. These ARE the calendar events, so
 * an admin adds, edits and deletes them exactly where they always did, and a
 * photograph added there appears here without anybody publishing anything
 * twice.
 */
export function UpcomingClasses({
  events,
  onPress,
  title,
}: {
  events: CalendarEvent[];
  onPress: (event: CalendarEvent) => void;
  title?: string;
}) {
  const { t } = useTranslation();
  if (events.length === 0) return null;

  return (
    <>
      <SectionHeader title={title ?? t('dashboard.upcomingClasses')} icon="images-outline" />

      {/* Horizontal, because these are browsed rather than worked through, and
          a vertical list of photographs would push everything else off the
          screen on a phone. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {events.map((event) => (
          <Pressable
            key={event.id}
            onPress={() => onPress(event)}
            accessibilityRole="button"
            accessibilityLabel={event.title}
            style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
          >
            {event.bannerUrl ? (
              <Image
                source={{ uri: event.bannerUrl }}
                style={styles.photo}
                resizeMode="cover"
              />
            ) : (
              // A tinted panel rather than a broken frame. An event with no
              // photograph is completely normal and should not look like an
              // event whose photograph failed to load.
              <View style={[styles.photo, styles.photoEmpty]}>
                <Ionicons name="calendar" size={26} color={brand.orange} />
              </View>
            )}

            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {event.title}
              </Text>
              <View style={styles.factRow}>
                <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.fact} numberOfLines={1}>
                  {formatShortDate(event.date)}
                  {event.startTime ? `  ·  ${event.startTime}` : ''}
                </Text>
              </View>
              {event.venue || event.location ? (
                <View style={styles.factRow}>
                  <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                  <Text style={styles.fact} numberOfLines={1}>
                    {[event.venue, event.location].filter(Boolean).join(', ')}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingRight: spacing.md, paddingBottom: spacing.xs },
  card: {
    width: 230,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadow.md,
  },
  photo: { width: '100%', height: 120, backgroundColor: colors.surfaceMuted },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md },
  title: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: 4,
  },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  fact: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
});
