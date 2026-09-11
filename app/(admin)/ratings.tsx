import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useLive } from '@/hooks/useLive';
import {
  groupByTarget,
  summarise,
  watchRatings,
  type RatingSummary,
} from '@/services/ratingService';
import { formatShortDate } from '@/utils/date';
import type { Rating, RatingTarget } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import {
  AppHeader,
  AsyncBoundary,
  Card,
  ChipGroup,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
} from '@/components/ui';

/**
 * What everybody thought, in one place.
 *
 * Three kinds of rating share one collection, so they share one screen: the
 * app overall, then each lesson, then each event. Splitting them across three
 * screens would mean an admin checking three places to learn one thing.
 *
 * Live, because a rating is the sort of thing somebody wants to watch arrive
 * after a class has just finished.
 */
export default function AdminRatings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RatingTarget>('app');

  const subscribe = useCallback(
    (onNext: (items: Rating[]) => void, onError: (error: unknown) => void) =>
      watchRatings(onNext, onError, 300),
    []
  );

  const { data, loading, error, reload } = useLive(subscribe, []);
  const ratings = useMemo(() => data ?? [], [data]);

  const groups = useMemo(() => groupByTarget(ratings, tab), [ratings, tab]);
  const overall = useMemo(
    () => summarise(ratings.filter((r) => r.target === tab)),
    [ratings, tab]
  );

  return (
    <PermissionGuard permission="VIEW_RESULTS">
      <View style={{ flex: 1 }}>
        <AppHeader title={t('rating.adminTitle')} />
        <Screen>
          <ChipGroup<RatingTarget>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'app', label: t('rating.overall') },
              { value: 'lesson', label: t('rating.byLesson') },
              { value: 'event', label: t('rating.byEvent') },
            ]}
          />

          <Spacer />

          <AsyncBoundary
            loading={loading}
            error={error}
            empty={ratings.filter((r) => r.target === tab).length === 0}
            onRetry={reload}
            skeleton={<SkeletonList count={4} />}
            emptyProps={{
              icon: 'star-outline',
              title: t('rating.noRatings'),
              message: t('rating.noRatingsBody'),
            }}
          >
            {/* The headline for whichever kind is being looked at. The app has
                one score; lessons and events have one across all of them,
                which is still the number worth seeing first. */}
            <Card>
              <Headline summary={overall} />
            </Card>

            <Spacer />

            {groups.map((group) => (
              <View key={group.id} style={{ marginBottom: spacing.lg }}>
                <SectionHeader
                  title={group.title ?? t('rating.overall')}
                  icon={tab === 'event' ? 'calendar-outline' : 'book-outline'}
                />
                <Card>
                  <Headline summary={group.summary} compact />

                  {/* Only the ones somebody wrote something on. A screen of
                      bare star counts tells an admin nothing they cannot read
                      off the average above it. */}
                  {group.ratings
                    .filter((rating) => rating.comment)
                    .map((rating) => (
                      <View key={rating.id} style={styles.comment}>
                        <View style={styles.commentHead}>
                          <Stars value={rating.stars} size={12} />
                          <Text style={styles.who} numberOfLines={1}>
                            {rating.userName}
                          </Text>
                          {rating.updatedAt ? (
                            <Text style={styles.when}>{formatShortDate(rating.updatedAt)}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.commentText}>{rating.comment}</Text>
                      </View>
                    ))}
                </Card>
              </View>
            ))}
          </AsyncBoundary>
        </Screen>
      </View>
    </PermissionGuard>
  );
}

/** The average, the count, and how the answers were spread across the five. */
function Headline({ summary, compact }: { summary: RatingSummary; compact?: boolean }) {
  const { t } = useTranslation();

  if (summary.average === null) {
    return <Text style={styles.none}>{t('rating.noneYet')}</Text>;
  }

  return (
    <View style={styles.headline}>
      <View style={styles.averageBlock}>
        <Text style={styles.average}>{summary.average.toFixed(1)}</Text>
        <Text style={styles.averageOf}>{t('rating.averageOf')}</Text>
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Stars value={Math.round(summary.average)} size={compact ? 14 : 18} />
        <Text style={styles.count}>{t('rating.responses', { count: summary.count })}</Text>

        {/* The spread, because ten people split between five and one average
            the same as ten who all said three — and only one of those is a
            platform with a problem worth finding. */}
        {!compact
          ? [5, 4, 3, 2, 1].map((star) => {
              const n = summary.spread[star - 1];
              const share = summary.count ? (n / summary.count) * 100 : 0;
              return (
                <View key={star} style={styles.barRow}>
                  <Text style={styles.barLabel}>{star}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${share}%` }]} />
                  </View>
                  <Text style={styles.barCount}>{n}</Text>
                </View>
              );
            })
          : null}
      </View>
    </View>
  );
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={star <= value ? 'star' : 'star-outline'}
          size={size}
          color={star <= value ? brand.orange : colors.border}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  averageBlock: { alignItems: 'center', minWidth: 56 },
  average: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.heavy,
    color: brand.navyDeep,
    lineHeight: fontSize.display * 1.1,
  },
  averageOf: { fontSize: fontSize.xs, color: colors.textMuted },
  count: { fontSize: fontSize.xs, color: colors.textSecondary },
  none: { fontSize: fontSize.sm, color: colors.textSecondary },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { fontSize: fontSize.xs, color: colors.textMuted, width: 10 },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: brand.orange, borderRadius: radius.pill },
  barCount: { fontSize: fontSize.xs, color: colors.textMuted, width: 22, textAlign: 'right' },

  comment: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
    marginTop: spacing.md,
    gap: 4,
  },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  who: { flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.text },
  when: { fontSize: fontSize.xs, color: colors.textMuted },
  commentText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
});
