import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import * as calendar from '@/services/calendarService';
import { GuestSignInCard } from '@/components/shared/GuestGate';
import { AppHeader, Card, EmptyState, Screen, SkeletonList } from '@/components/ui';

/**
 * Events and classes, as a guest sees them.
 *
 * Read from the PUBLIC schedule, never from the events themselves. An event
 * record carries its meeting link, and a security rule can only share a whole
 * record or none of it — so opening events to guests would have handed every
 * online class's join link to anybody who asked. The public copy holds only
 * what a poster would say: title, date, time, venue, speaker, picture.
 *
 * Nothing here books anything. A guest is signed out, the database refuses a
 * booking from them, and the card at the top says so before they look.
 */
export function GuestEventsList({
  titleKey = 'nav.events',
  onlyBookable = true,
  backButton = true,
}: {
  titleKey?: string;
  /** True on the Events page, which is about tickets; false on the Calendar. */
  onlyBookable?: boolean;
  backButton?: boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<calendar.PublicClass[] | null>(null);

  useEffect(
    () =>
      calendar.watchPublicSchedule(50, (items) =>
        setRows(onlyBookable ? items.filter((row) => row.takesBookings) : items)
      ),
    [onlyBookable]
  );

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t(titleKey)} showBack={backButton} />
      <Screen>
        <GuestSignInCard message={t(onlyBookable ? 'guestMode.booking' : 'guestMode.schedule')} />

        {rows === null ? (
          <View style={{ marginTop: spacing.md }}>
            <SkeletonList count={2} />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState icon="calendar-outline" title={t('event.none')} message={t('event.noneHelp')} />
        ) : (
          rows.map((row) => (
            <Card key={row.id} style={styles.card} padded={false}>
              {row.bannerUrl ? (
                <Image
                  source={{ uri: row.bannerUrl }}
                  style={styles.banner}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : null}
              <View style={styles.body}>
                <Text style={styles.title} numberOfLines={2}>
                  {row.title}
                </Text>
                <Fact icon="calendar-outline" text={formatShortDate(row.date)} />
                {row.startTime ? (
                  <Fact
                    icon="time-outline"
                    text={row.endTime ? `${row.startTime} - ${row.endTime}` : row.startTime}
                  />
                ) : null}
                {row.venue ? <Fact icon="location-outline" text={row.venue} /> : null}
                {row.speaker ? <Fact icon="mic-outline" text={row.speaker} /> : null}
                {row.description ? (
                  <Text style={styles.description} numberOfLines={3}>
                    {row.description}
                  </Text>
                ) : null}
              </View>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}

function Fact({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.factText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, overflow: 'hidden' },
  banner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceMuted },
  body: { padding: spacing.md, gap: 4 },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: 2,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  factText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  description: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
});
