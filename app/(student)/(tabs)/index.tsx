import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { brand, colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { toDate } from '@/utils/date';
import { nextEventFor } from '@/services/calendarService';
import { getFeaturedVideo, getLiveVideo, listVideosForStudent } from '@/services/videoService';
import { getLatestArticle, lessonsForStudent } from '@/services/contentService';
import { announcementsFor } from '@/services/notificationService';
import { scheduleEventReminders } from '@/services/pushService';
import { listUpcoming } from '@/services/calendarService';
import {
  AnnouncementCard,
  ArticleCard,
  FeaturedVideoCard,
  LessonRow,
  QuickAccessTile,
  UpcomingEventCard,
  VideoRow,
} from '@/components/shared/ContentCards';
import { AppFooter } from '@/components/shared/AppFooter';
import { IslamicTiles } from '@/components/shared/IslamicTiles';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  Avatar,
  Card,
  EmptyState,
  Grid,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
} from '@/components/ui';

/**
 * Student home.
 *
 * Loads in one pass: next event, featured video, latest article, this term's
 * lessons, recent recordings and announcements. Each is a bounded query, so the
 * whole screen is roughly a dozen document reads.
 */
export default function StudentHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  // This dashboard remembers its own language; see useLanguageScope.
  const { language: dashboardLanguage, setLanguage: setDashboardLanguage } =
    useLanguageScope('student');
  const router = useRouter();

  const load = useCallback(async () => {
    if (!user) return null;
    const [event, liveVideo, featuredVideo, article, lessons, recordings, announcements] =
      await Promise.all([
      nextEventFor(user).catch(() => null),
      getLiveVideo().catch(() => null),
      getFeaturedVideo().catch(() => null),
      getLatestArticle().catch(() => null),
      user.classId
        ? lessonsForStudent(user.classId, 4).then((p) => p.items).catch(() => [])
        : Promise.resolve([]),
      listVideosForStudent(user.classId, 'recording', 3).catch(() => []),
      announcementsFor(user, 3).catch(() => []),
    ]);
    return { event, liveVideo, featuredVideo, article, lessons, recordings, announcements };
  }, [user]);

  const { data, loading, refreshing, refresh } = useAsync(load, [user?.uid, user?.classId]);

  // Schedules on-device reminders for the next few classes.
  useEffect(() => {
    if (!user) return;
    listUpcoming({ classId: user.classId ?? undefined, pageSize: 5 })
      .then((page) => {
        const events = page.items.flatMap((event) => {
          const startsAt = toDate(event.startsAt);
          // Events without a resolvable instant cannot be scheduled against.
          return startsAt
            ? [{ id: event.id, title: event.title, venue: event.venue, startsAt }]
            : [];
        });
        return scheduleEventReminders(events);
      })
      .catch(() => undefined);
  }, [user]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['top', 'bottom']}>
      <View style={styles.greetingRow}>
        <View style={styles.greetingText}>
          <Text style={styles.salaam}>{t('app.greeting')}</Text>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
            {user?.fullName ?? ''}
          </Text>
          {user?.studentId ? <Text style={styles.studentId}>{user.studentId}</Text> : null}
        </View>
        <LanguageMenu
          value={dashboardLanguage}
          onChange={setDashboardLanguage}
          tint={colors.textSecondary}
        />
        <Avatar name={user?.fullName ?? '?'} uri={user?.profileImage} size={48} />
      </View>

      {!user?.classId ? (
        <Card style={styles.noticeCard}>
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
            <Text style={styles.noticeText}>{t('empty.notAssignedClass')}</Text>
          </View>
        </Card>
      ) : null}

      {loading ? (
        <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
          <SkeletonList count={3} />
        </View>
      ) : (
        <>
          <Spacer size={spacing.lg} />

          {data?.event ? (
            <UpcomingEventCard
              event={data.event}
              locale={language}
              onPress={() => router.push('/(student)/(tabs)/calendar')}
            />
          ) : (
            <Card>
              <View style={styles.noticeRow}>
                <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                <Text style={styles.noticeText}>{t('dashboard.noUpcomingEvents')}</Text>
              </View>
            </Card>
          )}

          {data?.liveVideo ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader title={t('video.liveNow')} icon="radio-outline" />
              <FeaturedVideoCard
                video={data.liveVideo}
                locale={language}
                onPress={() => router.push(`/(student)/video/${data.liveVideo!.id}`)}
              />
            </>
          ) : null}

          {data?.featuredVideo && data.featuredVideo.id !== data.liveVideo?.id ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader title={t('dashboard.newRelease')} icon="play-circle-outline" />
              <FeaturedVideoCard
                video={data.featuredVideo}
                locale={language}
                onPress={() => router.push(`/(student)/video/${data.featuredVideo!.id}`)}
              />
            </>
          ) : null}

          {data?.article ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader title={t('dashboard.latestArticle')} icon="newspaper-outline" />
              <ArticleCard
                article={data.article}
                featured
                locale={language}
                onPress={() => router.push(`/(student)/article/${data.article!.id}`)}
              />
            </>
          ) : null}

          <Spacer size={spacing.xxl} />
          <SectionHeader title={t('dashboard.quickAccess')} icon="grid-outline" />
          <Grid minItemWidth={100} gap={spacing.md}>
            <QuickAccessTile
              icon="book-outline"
              label={t('nav.lessons')}
              tint={brand.orange}
              onPress={() => router.push('/(student)/(tabs)/lessons')}
            />
            <QuickAccessTile
              icon="videocam-outline"
              label={t('nav.recordings')}
              tint={brand.navy}
              onPress={() => router.push('/(student)/recordings')}
            />
            <QuickAccessTile
              icon="folder-open-outline"
              label={t('nav.materials')}
              tint={brand.sand}
              onPress={() => router.push('/(student)/materials')}
            />
            <QuickAccessTile
              icon="help-circle-outline"
              label={t('nav.quizzes')}
              tint={brand.orangeLight}
              onPress={() => router.push('/(student)/quizzes')}
            />
            <QuickAccessTile
              icon="checkbox-outline"
              label={t('nav.attendance')}
              tint={brand.slate}
              onPress={() => router.push('/(student)/attendance')}
            />
            <QuickAccessTile
              icon="trophy-outline"
              label={t('nav.results')}
              tint={brand.orange}
              onPress={() => router.push('/(student)/results')}
            />
            <QuickAccessTile
              icon="videocam"
              label={t('nav.onlineClasses')}
              tint={brand.red}
              onPress={() => router.push('/(student)/online-classes')}
            />
            <QuickAccessTile
              icon="sparkles"
              label={t('video.newReleases')}
              tint={brand.orangeLight}
              onPress={() => router.push('/(student)/new-releases')}
            />
            <QuickAccessTile
              icon="chatbubbles"
              label={t('nav.qa')}
              tint={brand.navy}
              onPress={() => router.push('/(student)/qa')}
            />
            <QuickAccessTile
              icon="stats-chart"
              label={t('nav.myProgress')}
              tint={brand.slate}
              onPress={() => router.push('/(student)/progress')}
            />
            <QuickAccessTile
              icon="help-buoy"
              label={t('nav.support')}
              tint={brand.sand}
              onPress={() => router.push('/(student)/support')}
            />
          </Grid>

          <IslamicTiles basePath="/(student)" />

          <AppFooter />

          {data?.lessons.length ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader
                title={t('dashboard.weeklyLessons')}
                icon="book-outline"
                actionLabel={t('common.viewAll')}
                onAction={() => router.push('/(student)/(tabs)/lessons')}
              />
              <View style={styles.stack}>
                {data.lessons.map((lesson) => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    onPress={() => router.push(`/(student)/lesson/${lesson.id}`)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {data?.recordings.length ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader
                title={t('dashboard.classRecordings')}
                icon="videocam-outline"
                actionLabel={t('common.viewAll')}
                onAction={() => router.push('/(student)/recordings')}
              />
              <View style={styles.stack}>
                {data.recordings.map((video) => (
                  <VideoRow
                    key={video.id}
                    video={video}
                    locale={language}
                    onPress={() => router.push(`/(student)/video/${video.id}`)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {data?.announcements.length ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader title={t('dashboard.announcements')} icon="megaphone-outline" />
              <View style={styles.stack}>
                {data.announcements.map((announcement) => (
                  <AnnouncementCard key={announcement.id} announcement={announcement} />
                ))}
              </View>
            </>
          ) : null}

          {!data?.event &&
          !data?.featuredVideo &&
          !data?.article &&
          !data?.lessons.length &&
          !data?.recordings.length ? (
            <EmptyState
              icon="sparkles-outline"
              title={t('empty.nothingHere')}
              message={t('empty.checkBackSoon')}
            />
          ) : null}
        </>
      )}

      <Spacer size={spacing.xxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  greetingText: { flex: 1 },
  salaam: { fontSize: fontSize.sm, color: colors.textSecondary },
  name: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text, marginTop: 2 },
  studentId: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  noticeCard: { marginTop: spacing.lg, borderColor: colors.warning, borderWidth: 1 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  noticeText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  stack: { gap: spacing.md },
});
