import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import { listPast, listUpcoming } from '@/services/calendarService';
import { totalsFor, type EventTotals } from '@/services/eventFinanceService';
import type { CalendarEvent } from '@/types';
import { AppHeader, AsyncBoundary, Card, Screen, SkeletonList, Spacer } from '@/components/ui';

/**
 * Every event, each with its own figures — and never a figure across events.
 *
 * ONE EVENT, ONE ROW, ONE SET OF NUMBERS. The centre runs a family gathering,
 * an Umrah trip and a course in the same month, paid for out of different
 * pockets and answerable to different people. A combined total would be a
 * number nobody could act on, so this screen does not compute one: each row
 * stands alone, and opening a row goes to that event's own accounts.
 *
 * Reached by an admin, and by an assistant holding VIEW_EVENT_DASHBOARD and
 * nothing else — which is the point of that permission existing.
 */
/**
 * How many events are looked at from each direction.
 *
 * Twelve and twelve, not fifty: each one costs two queries to total up, the
 * centre does not run more than a handful at a time, and a year of history on
 * one screen is a scroll nobody reads. Older events are still reachable from
 * the events screen.
 */
const PER_SIDE = 12;

export function EventDashboard({ route }: { route: '(admin)' | '(teacher)' }) {
  const { t } = useTranslation();
  const router = useRouter();

  const load = useCallback(async () => {
    /*
     * Coming up AND gone by, because an event's accounts matter most after it
     * has happened: the hall is paid for on the day, the leftover is counted
     * the week after. Two queries rather than one, since the service keeps
     * them apart and a date filter cannot span both directions at once.
     */
    const [soon, past] = await Promise.all([
      listUpcoming({ pageSize: PER_SIDE }),
      listPast({ pageSize: PER_SIDE }),
    ]);
    /*
     * Ticketed events only.
     *
     * An entry with no `registration` map is a class or a notice: it has no
     * bookings, no seats and no money, so a row of zeroes for it would be
     * noise — and, more to the point, two queries per event against a free
     * tier that has run out of reads once already. The schedule screen is
     * where the rest of the calendar lives.
     */
    const events = [...soon.items, ...past.items].filter((event) => event.registration);
    // One pass per event, in parallel. An event's bookings are tens, and this
    // screen is opened by one or two people a week.
    const totals = await Promise.all(
      events.map(async (event) => [event.id, await totalsFor(event.id).catch(() => null)] as const)
    );
    return { events, totals: Object.fromEntries(totals) as Record<string, EventTotals | null> };
  }, []);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, []);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('eventDash.title')} subtitle={t('eventDash.lead')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={(data?.events ?? []).length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={4} />}
          emptyProps={{ icon: 'calendar-outline', title: t('eventDash.noEvents') }}
        >
          <View style={{ gap: spacing.md }}>
            {(data?.events ?? []).map((event: CalendarEvent) => {
              const sum = data?.totals[event.id] ?? null;
              const currency = sum?.currency ?? 'SAR';
              const outstanding = sum ? sum.bookedDue - sum.bookedReceived : 0;

              return (
                <Card
                  key={event.id}
                  onPress={() => router.push(`/${route}/event-dashboard/${event.id}`)}
                  accessibilityLabel={event.title}
                >
                  <View style={styles.head}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title} numberOfLines={1}>
                        {event.title}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {[formatShortDate(event.date), event.venue].filter(Boolean).join('  ·  ')}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>

                  <View style={styles.figures}>
                    <Figure label={t('eventDash.bookings')} value={String(sum?.bookings ?? 0)} />
                    <Figure label={t('eventDash.people')} value={String(sum?.participants ?? 0)} />
                    <Figure
                      label={t('eventDash.received')}
                      value={`${sum?.bookedReceived ?? 0} ${currency}`}
                      tone={colors.success}
                    />
                    <Figure
                      label={t('eventDash.outstanding')}
                      value={`${outstanding} ${currency}`}
                      tone={outstanding > 0 ? colors.warning : colors.textMuted}
                    />
                    <Figure
                      label={t('eventDash.net')}
                      value={`${sum?.net ?? 0} ${currency}`}
                      tone={colors.text}
                    />
                  </View>
                </Card>
              );
            })}
          </View>

          <Spacer />
          <Text style={styles.footnote}>{t('eventDash.separateNote')}</Text>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.figureValue, tone ? { color: tone } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  figure: {
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  figureLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  figureValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  footnote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
});
