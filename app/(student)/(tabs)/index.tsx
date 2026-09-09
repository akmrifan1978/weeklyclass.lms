import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { NotificationBell } from '@/components/shared/NotificationBell';
import { StatTile } from '@/components/shared/StatTile';
import * as progressService from '@/services/progressService';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  radius,
  spacing,
} from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { toDate } from '@/utils/date';
import { nextEventFor } from '@/services/calendarService';
import { getFeaturedVideo, getLiveVideo, listVideosForStudent } from '@/services/videoService';
import { getLatestArticle, lessonsForStudent } from '@/services/contentService';
import { getClass } from '@/services/orgService';
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
import { IslamicTiles } from '@/components/shared/IslamicTiles';
import { CollapsibleGrid } from '@/components/shared/CollapsibleGrid';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { LogoutButton } from '@/components/shared/LogoutButton';
import { UpcomingClasses } from '@/components/shared/UpcomingClasses';
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
    const [
      event,
      progress,
      upcoming,
      liveVideo,
      featuredVideo,
      article,
      lessons,
      recordings,
      announcements,
      classGroup,
    ] =
      await Promise.all([
      nextEventFor(user).catch(() => null),
      // The student's own figures. Added to the existing parallel batch
      // rather than fetched after it, so it costs no extra waiting — and
      // they were being computed for the progress screen already while the
      // dashboard, the screen they actually land on, showed them nothing.
      progressService.loadUserProgress(user).catch(() => null),
      // Already fetched for the reminder scheduler and then discarded. Kept
      // now, because the same list is what the photographs are drawn from.
      listUpcoming({ classId: user.classId ?? undefined, pageSize: 6 })
        // Classes only. An entry carrying `registration` is a ticketed
        // event and lives on the events screen, with its seat count and
        // its booking button; showing it here as a class is what made
        // the two look like one thing.
        .then((page) => page.items.filter((event) => !event.registration))
        .catch(() => []),
      getLiveVideo().catch(() => null),
      getFeaturedVideo().catch(() => null),
      getLatestArticle().catch(() => null),
      user.classId
        ? lessonsForStudent(user.classId, 4).then((p) => p.items).catch(() => [])
        : Promise.resolve([]),
      listVideosForStudent(user.classId, 'recording', 3).catch(() => []),
      announcementsFor(user, 3).catch(() => []),
      // The group this student is in, for the names of whoever teaches it.
      // One document, and it carries the names already — see ClassRoom.
      user.classId ? getClass(user.classId).catch(() => null) : Promise.resolve(null),
    ]);
    return {
      event,
      progress,
      upcoming,
      liveVideo,
      featuredVideo,
      article,
      lessons,
      recordings,
      announcements,
      classGroup,
    };
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
      {/* A panel rather than loose text.
          The same words sat directly on the page background, which made the
          screen open on nothing in particular. Given a ground of its own, the
          greeting becomes a place — and the id and the class, which a student
          is asked for constantly, are on it rather than buried. */}
      <View style={styles.hero}>
        <View style={styles.greetingRow}>
        <View style={styles.greetingText}>
          <Text style={styles.salaam}>{t('app.greeting')}</Text>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
            {user?.fullName ?? ''}
          </Text>

          <View style={styles.chipRow}>
            {user?.studentId ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{user.studentId}</Text>
              </View>
            ) : null}
            {data?.classGroup ? (
              <View style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {data.classGroup.name}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Who teaches this student, on the screen they land on.
              The group is the assignment — a student never picks a teacher —
              so this is read from the group rather than stored on the person,
              which means an admin moving somebody between groups changes it
              without touching the student record at all. */}
          {data?.classGroup ? (
            <View style={styles.teacherRow}>
              <Ionicons name="person-circle-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.teacherText} numberOfLines={2}>
                {(data.classGroup.teacherNames ?? []).length > 0
                  ? t('classGroup.yourTeachers', {
                      names: (data.classGroup.teacherNames ?? []).join(', '),
                    })
                  : t('classGroup.noTeacherYet')}
                {'  ·  '}
                {data.classGroup.name}
              </Text>
            </View>
          ) : null}
        </View>
        {/* Unread messages, on the screen everybody lands on. The tab bar
            carries the same count, but only once you are looking at it — this
            is the corner people actually glance at. */}
        <NotificationBell tint={colors.textSecondary} size={24} />
        <LanguageMenu
          value={dashboardLanguage}
          onChange={setDashboardLanguage}
          tint={colors.textSecondary}
        />
        <Avatar name={user?.fullName ?? '?'} uri={user?.profileImage} size={48} />

        {/* Beside the avatar, on the screen everybody lands on. A shared
            phone needs a way out that is not behind two taps. */}
        <LogoutButton tint={brand.red} />
        </View>
      </View>

      {!user?.classId ? (
        <Card style={styles.noticeCard}>
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
            <Text style={styles.noticeText}>{t('empty.notAssignedClass')}</Text>
          </View>
        </Card>
      ) : null}

      {/* Their own figures, on the screen they land on. These were computed
          for the progress screen already and never shown here, which is where
          somebody actually wonders how they are doing. */}
      {data?.progress ? (
        <View style={styles.statRow}>
          <StatTile
            icon="calendar-outline"
            value={`${data.progress.attendance.percent}%`}
            label={t("progress.attendance")}
            hint={t("progress.attendedOf", {
              present: data.progress.attendance.present,
              total: data.progress.attendance.total,
            })}
            tint={colors.success}
          />
          <StatTile
            icon="document-text-outline"
            value={`${data.progress.assignments.submitted}/${data.progress.assignments.available}`}
            label={t("progress.assignments")}
            tint={colors.primary}
          />
          <StatTile
            icon="book-outline"
            value={String(data.progress.lessons.available)}
            label={t("progress.lessons")}
            tint={brand.orange}
          />
          {data.progress.quran ? (
            <StatTile
              icon="bookmark-outline"
              value={`${data.progress.quran.percent}%`}
              label={t("quran.readingPlan")}
              hint={t("quran.streak", { count: data.progress.quran.streak })}
              tint={brand.slate}
            />
          ) : null}
        </View>
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

          {(data?.upcoming?.length ?? 0) > 0 ? (
            <>
              <Spacer size={spacing.xxl} />
              <UpcomingClasses
                events={data!.upcoming}
                onPress={() => router.push('/(student)/(tabs)/calendar')}
              />
            </>
          ) : null}

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
          <CollapsibleGrid title={t('dashboard.quickAccess')} icon="grid-outline">
            {/* First, because this is the one somebody reaches for
                mid-lesson, when the thought is about to be lost. */}
            <QuickAccessTile
              icon="create-outline"
              label={t('nav.notes')}
              tint={brand.slate}
              onPress={() => router.push('/(student)/notes')}
            />
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
              icon="ticket"
              label={t('nav.events')}
              tint={brand.orangeLight}
              onPress={() => router.push('/(student)/events')}
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
          </CollapsibleGrid>

          <IslamicTiles basePath="/(student)" />

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
  hero: {
    backgroundColor: brand.navyDeep,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    // A translucent white rather than a named colour: it has to sit on the
    // navy here and would need a second definition anywhere else.
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: brand.sandLight },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  greetingText: { flex: 1 },
  salaam: { fontSize: fontSize.sm, color: brand.sandLight },
  name: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.textInverse, marginTop: 2 },
  studentId: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  teacherRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  teacherText: { flex: 1, fontSize: fontSize.xs, color: brand.sandLight, lineHeight: 16 },
  noticeCard: { marginTop: spacing.lg, borderColor: colors.warning, borderWidth: 1 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  noticeText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  stack: { gap: spacing.md },
});
