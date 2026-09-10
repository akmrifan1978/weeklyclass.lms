import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { NotificationBell } from '@/components/shared/NotificationBell';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { brand, colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useTeacherScope } from '@/hooks/useTeacherScope';
import { listUpcoming, nextEventFor } from '@/services/calendarService';
import { loadTeacherStats } from '@/services/statsService';
import { announcementsFor } from '@/services/notificationService';
import type { Permission } from '@/types';
import {
  AnnouncementCard,
  QuickAccessTile,
  UpcomingEventCard,
} from '@/components/shared/ContentCards';
import { IslamicTiles } from '@/components/shared/IslamicTiles';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { LogoutButton } from '@/components/shared/LogoutButton';
import { UpcomingClasses } from '@/components/shared/UpcomingClasses';
import { FlyerStrip } from '@/components/shared/FlyerStrip';
import {
  Avatar,
  Card,
  Grid,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
  StatCard,
} from '@/components/ui';

/**
 * Teacher home.
 *
 * The quick-access grid is filtered by permission, so a teacher who has not
 * been granted quiz creation simply does not see the tile — and the matching
 * Firestore rule would refuse the write even if they navigated there directly.
 */
export default function TeacherHome() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { language } = useLanguage();
  // This dashboard remembers its own language; see useLanguageScope.
  const { language: dashboardLanguage, setLanguage: setDashboardLanguage } =
    useLanguageScope('teacher');
  const router = useRouter();
  const { classes, classIds, loading: scopeLoading } = useTeacherScope();

  const load = useCallback(async () => {
    if (!user) return null;
    const [stats, event, upcoming, announcements] = await Promise.all([
      loadTeacherStats(classIds).catch(() => ({
        classes: classIds.length,
        students: 0,
        lessons: 0,
        quizzes: 0,
      })),
      nextEventFor(user).catch(() => null),
      listUpcoming({ pageSize: 6 })
        // Classes only. An entry carrying `registration` is a ticketed
        // event and lives on the events screen, with its seat count and
        // its booking button; showing it here as a class is what made
        // the two look like one thing.
        .then((page) => page.items.filter((event) => !event.registration))
        .catch(() => []),
      announcementsFor(user, 3).catch(() => []),
    ]);
    return { stats, event, upcoming, announcements };
  }, [user, classIds.join(',')]);

  const { data, loading, refreshing, refresh } = useAsync(load, [user?.uid, classIds.join(',')], {
    enabled: !scopeLoading,
  });

  const tiles: { permission: Permission; icon: React.ComponentProps<typeof QuickAccessTile>['icon']; labelKey: string; route: string; tint: string }[] = [
    { permission: 'VIEW_STUDENTS', icon: 'people-outline', labelKey: 'nav.myStudents', route: '/(teacher)/students', tint: brand.navy },
    { permission: 'VIEW_LESSONS', icon: 'book-outline', labelKey: 'nav.lessons', route: '/(teacher)/lessons', tint: brand.orange },
    { permission: 'UPLOAD_VIDEO', icon: 'radio-button-on', labelKey: 'record.title', route: '/(teacher)/record', tint: brand.red },
    { permission: 'UPLOAD_VIDEO', icon: 'film-outline', labelKey: 'video.recordings', route: '/(teacher)/recordings', tint: brand.slate },
    { permission: 'UPLOAD_VIDEO', icon: 'videocam-outline', labelKey: 'nav.videos', route: '/(teacher)/videos', tint: brand.orangeLight },
    { permission: 'UPLOAD_MATERIAL', icon: 'folder-open-outline', labelKey: 'nav.materials', route: '/(teacher)/materials', tint: brand.sand },
    { permission: 'CREATE_QUIZ', icon: 'help-circle-outline', labelKey: 'nav.quizzes', route: '/(teacher)/quizzes', tint: brand.navy },
    { permission: 'VIEW_RESULTS', icon: 'trophy-outline', labelKey: 'nav.results', route: '/(teacher)/results', tint: brand.orange },
    { permission: 'MANAGE_CALENDAR', icon: 'calendar-outline', labelKey: 'nav.calendar', route: '/(teacher)/calendar', tint: brand.slate },
    { permission: 'MANAGE_CALENDAR', icon: 'videocam', labelKey: 'nav.onlineClasses', route: '/(teacher)/online-classes', tint: brand.red },
    { permission: 'MANAGE_CALENDAR', icon: 'ticket', labelKey: 'nav.events', route: '/(teacher)/events', tint: brand.orangeLight },
    { permission: 'VIEW_STUDENTS', icon: 'chatbubbles', labelKey: 'nav.qa', route: '/(teacher)/qa', tint: brand.navy },
    { permission: 'VIEW_STUDENTS', icon: 'help-buoy', labelKey: 'nav.support', route: '/(teacher)/support', tint: brand.sand },
  ];

  const visibleTiles = tiles.filter((tile) => can(tile.permission));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['top', 'bottom']}>
        <FlyerStrip position="dashboard" />

      <View style={styles.greetingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.salaam}>{t('app.greeting')}</Text>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
            {user?.fullName ?? ''}
          </Text>
          {user?.teacherId ? <Text style={styles.teacherId}>{user.teacherId}</Text> : null}
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

      <Spacer />

      {loading || scopeLoading ? (
        <SkeletonList count={3} />
      ) : (
        <>
          {classes.length === 0 ? (
            <Card style={styles.noticeCard}>
              <View style={styles.noticeRow}>
                <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
                <Text style={styles.noticeText}>{t('empty.notAssignedClass')}</Text>
              </View>
            </Card>
          ) : null}

          <Grid minItemWidth={150} gap={spacing.md}>
            <StatCard
              label={t('nav.myClasses')}
              value={data?.stats.classes ?? classes.length}
              icon="library-outline"
              accent={brand.navy}
              onPress={() => router.push('/(teacher)/(tabs)/classes')}
            />
            <StatCard
              label={t('nav.myStudents')}
              value={data?.stats.students ?? 0}
              icon="people-outline"
              accent={brand.orange}
              onPress={() => router.push('/(teacher)/students')}
            />
            <StatCard
              label={t('nav.lessons')}
              value={data?.stats.lessons ?? 0}
              icon="book-outline"
              accent={brand.slate}
              onPress={() => router.push('/(teacher)/lessons')}
            />
            <StatCard
              label={t('nav.quizzes')}
              value={data?.stats.quizzes ?? 0}
              icon="help-circle-outline"
              accent={brand.orangeLight}
              onPress={() => router.push('/(teacher)/quizzes')}
            />
          </Grid>

          {data?.event ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader title={t('dashboard.nextEvent')} icon="calendar-outline" />
              <UpcomingEventCard event={data.event} locale={language} />
            </>
          ) : null}

          {/*
            Prayer times and the Qur'an are not gated on a permission. They are
            not teaching tools an admin grants access to — they are for the
            person, and every teacher should be able to reach them.
          */}
          {(data?.upcoming?.length ?? 0) > 0 ? (
            <>
              <Spacer size={spacing.xxl} />
              <UpcomingClasses
                events={data!.upcoming}
                onPress={() => router.push('/(teacher)/(tabs)/calendar' as never)}
              />
            </>
          ) : null}

          <Spacer size={spacing.xxl} />
          <SectionHeader title={t('dashboard.quickAccess')} icon="grid-outline" />
          <Grid minItemWidth={105} gap={spacing.md}>
            {/* Outside the permission-filtered list on purpose: a notebook
                belongs to the person, not to a role, so there is no permission
                that could withhold it. */}
            <QuickAccessTile
              icon="create-outline"
              label={t('nav.notes')}
              tint={brand.slate}
              onPress={() => router.push('/(teacher)/notes')}
            />
            {visibleTiles.map((tile) => (
              <QuickAccessTile
                key={tile.route}
                icon={tile.icon}
                label={t(tile.labelKey)}
                tint={tile.tint}
                onPress={() => router.push(tile.route as never)}
              />
            ))}
          </Grid>

          <IslamicTiles basePath="/(teacher)" />

          {visibleTiles.length ? null : (
            <>
              <Spacer size={spacing.xxl} />
              <Card>
                <Text style={styles.noticeText}>{t('empty.noAccess')}</Text>
              </Card>
            </>
          )}

          {data?.announcements.length ? (
            <>
              <Spacer size={spacing.xxl} />
              <SectionHeader title={t('dashboard.announcements')} icon="megaphone-outline" />
              <View style={{ gap: spacing.md }}>
                {data.announcements.map((announcement) => (
                  <AnnouncementCard key={announcement.id} announcement={announcement} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}

      <Spacer size={spacing.xxxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  salaam: { fontSize: fontSize.sm, color: colors.textSecondary },
  name: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text, marginTop: 2 },
  teacherId: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  noticeCard: { marginBottom: spacing.lg, borderColor: colors.warning, borderWidth: 1 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  noticeText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
});
