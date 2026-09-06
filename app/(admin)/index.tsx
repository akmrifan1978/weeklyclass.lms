import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { brand, colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { relativeTime } from '@/utils/date';
import { humanise } from '@/utils/format';
import { loadDashboardStats } from '@/services/statsService';
import { listLogs } from '@/services/auditService';
import { listUsers } from '@/services/userService';
import { QuickAccessTile } from '@/components/shared/ContentCards';
import { IslamicTiles } from '@/components/shared/IslamicTiles';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AsyncBoundary,
  Avatar,
  Badge,
  Card,
  Grid,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
  StatCard,
} from '@/components/ui';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  // The admin dashboard remembers its own language; see useLanguageScope.
  const { language: dashboardLanguage, setLanguage: setDashboardLanguage } =
    useLanguageScope('admin');
  const router = useRouter();

  const load = useCallback(async () => {
    const [stats, logs, pending] = await Promise.all([
      loadDashboardStats(),
      listLogs({ pageSize: 8 }).then((p) => p.items).catch(() => []),
      listUsers({ status: 'pending', pageSize: 5 }).then((p) => p.items).catch(() => []),
    ]);
    return { stats, logs, pending };
  }, []);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, []);
  const stats = data?.stats;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.welcome}>{t('dashboard.welcomeAdmin')}</Text>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
            {user?.fullName}
          </Text>
        </View>
        <LanguageMenu
          value={dashboardLanguage}
          onChange={setDashboardLanguage}
          tint={colors.textSecondary}
        />
      </View>

      <Spacer />

      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={<SkeletonList count={4} />}
      >
        <SectionHeader title={t('dashboard.statistics')} icon="stats-chart-outline" />
        <Grid minItemWidth={155} gap={spacing.md}>
          <StatCard
            label={t('dashboard.totalStudents')}
            value={stats?.totalStudents ?? 0}
            icon="school-outline"
            accent={brand.navy}
            onPress={() => router.push('/(admin)/students')}
          />
          <StatCard
            label={t('dashboard.activeStudents')}
            value={stats?.activeStudents ?? 0}
            icon="checkmark-circle-outline"
            accent={colors.success}
            onPress={() => router.push('/(admin)/students')}
          />
          <StatCard
            label={t('dashboard.totalTeachers')}
            value={stats?.totalTeachers ?? 0}
            icon="people-outline"
            accent={brand.orange}
            onPress={() => router.push('/(admin)/teachers')}
          />
          <StatCard
            label={t('dashboard.activeTeachers')}
            value={stats?.activeTeachers ?? 0}
            icon="person-circle-outline"
            accent={colors.success}
            onPress={() => router.push('/(admin)/teachers')}
          />
          <StatCard
            label={t('dashboard.totalClasses')}
            value={stats?.totalClasses ?? 0}
            icon="library-outline"
            accent={brand.slate}
            onPress={() => router.push('/(admin)/classes')}
          />
          <StatCard
            label={t('dashboard.totalLessons')}
            value={stats?.totalLessons ?? 0}
            icon="book-outline"
            accent={brand.navy}
            onPress={() => router.push('/(admin)/lessons')}
          />
          <StatCard
            label={t('dashboard.totalVideos')}
            value={stats?.totalVideos ?? 0}
            icon="videocam-outline"
            accent={brand.orangeLight}
            onPress={() => router.push('/(admin)/videos')}
          />
          <StatCard
            label={t('dashboard.totalArticles')}
            value={stats?.totalArticles ?? 0}
            icon="newspaper-outline"
            accent={brand.sand}
            onPress={() => router.push('/(admin)/articles')}
          />
          <StatCard
            label={t('dashboard.upcomingEvents')}
            value={stats?.upcomingEvents ?? 0}
            icon="calendar-outline"
            accent={brand.navy}
            onPress={() => router.push('/(admin)/calendar')}
          />
          <StatCard
            label={t('dashboard.pendingRegistrations')}
            value={stats?.pendingRegistrations ?? 0}
            icon="hourglass-outline"
            accent={colors.warning}
            onPress={() => router.push('/(admin)/users')}
          />
          <StatCard
            label={t('dashboard.notificationsSent')}
            value={stats?.notificationsSent ?? 0}
            icon="send-outline"
            accent={brand.orange}
            onPress={() => router.push('/(admin)/notifications')}
          />
        </Grid>

        <Spacer size={spacing.xxl} />

        <SectionHeader title={t('dashboard.quickActions')} icon="flash-outline" />
        <Grid minItemWidth={110} gap={spacing.md}>
          <QuickAccessTile
            icon="person-add-outline"
            label={t('dashboard.addStudent')}
            tint={brand.navy}
            onPress={() => router.push({ pathname: '/(admin)/students', params: { action: 'new' } })}
          />
          <QuickAccessTile
            icon="people-outline"
            label={t('dashboard.addTeacher')}
            tint={brand.orange}
            onPress={() => router.push({ pathname: '/(admin)/teachers', params: { action: 'new' } })}
          />
          <QuickAccessTile
            icon="book-outline"
            label={t('dashboard.addLesson')}
            tint={brand.slate}
            onPress={() => router.push({ pathname: '/(admin)/lessons', params: { action: 'new' } })}
          />
          <QuickAccessTile
            icon="videocam-outline"
            label={t('dashboard.addVideo')}
            tint={brand.orangeLight}
            onPress={() => router.push({ pathname: '/(admin)/videos', params: { action: 'new' } })}
          />
          <QuickAccessTile
            icon="newspaper-outline"
            label={t('dashboard.addArticle')}
            tint={brand.sand}
            onPress={() => router.push({ pathname: '/(admin)/articles', params: { action: 'new' } })}
          />
          <QuickAccessTile
            icon="calendar-outline"
            label={t('dashboard.addEvent')}
            tint={brand.navy}
            onPress={() => router.push({ pathname: '/(admin)/calendar', params: { action: 'new' } })}
          />
          <QuickAccessTile
            icon="ticket"
            label={t('nav.events')}
            tint={brand.orangeLight}
            onPress={() => router.push('/(admin)/events')}
          />
          <QuickAccessTile
            icon="help-buoy"
            label={t('nav.support')}
            tint={brand.sand}
            onPress={() => router.push('/(admin)/support')}
          />
          <QuickAccessTile
            icon="chatbubbles"
            label={t('nav.qa')}
            tint={brand.navy}
            onPress={() => router.push('/(admin)/qa')}
          />
          <QuickAccessTile
            icon="videocam"
            label={t('nav.onlineClasses')}
            tint={brand.red}
            onPress={() => router.push('/(admin)/online-classes')}
          />
          <QuickAccessTile
            icon="send-outline"
            label={t('dashboard.sendNotification')}
            tint={brand.red}
            onPress={() =>
              router.push({ pathname: '/(admin)/notifications', params: { action: 'new' } })
            }
          />
        </Grid>

        <IslamicTiles basePath="/(admin)" />

        {data?.pending.length ? (
          <>
            <Spacer size={spacing.xxl} />
            <SectionHeader
              title={t('admin.pendingApprovals')}
              icon="hourglass-outline"
              actionLabel={t('common.viewAll')}
              onAction={() => router.push('/(admin)/users')}
            />
            <View style={{ gap: spacing.md }}>
              {data.pending.map((pendingUser) => (
                <Card
                  key={pendingUser.id}
                  onPress={() => router.push('/(admin)/users')}
                  accessibilityLabel={pendingUser.fullName}
                >
                  <View style={styles.row}>
                    <Avatar name={pendingUser.fullName} uri={pendingUser.profileImage} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {pendingUser.fullName}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {humanise(pendingUser.role)} · {pendingUser.email}
                      </Text>
                    </View>
                    <Badge label={t('common.pending')} tone="pending" />
                  </View>
                </Card>
              ))}
            </View>
          </>
        ) : null}

        <Spacer size={spacing.xxl} />

        <SectionHeader
          title={t('dashboard.recentActivity')}
          icon="time-outline"
          actionLabel={t('common.viewAll')}
          onAction={() => router.push('/(admin)/audit')}
        />
        {data?.logs.length ? (
          <Card>
            {data.logs.map((log, index) => (
              <View
                key={log.id}
                style={[styles.logRow, index > 0 ? styles.logRowBordered : null]}
              >
                <View style={styles.logIcon}>
                  <Ionicons name={iconForAction(log.action)} size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logSummary} numberOfLines={2}>
                    {log.summary}
                  </Text>
                  <Text style={styles.logMeta}>
                    {log.actorName} · {relativeTime(log.at ?? log.createdAt, language)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Text style={styles.rowMeta}>{t('admin.noAuditLogs')}</Text>
          </Card>
        )}

        <Spacer size={spacing.xxxl} />
      </AsyncBoundary>
    </Screen>
  );
}

function iconForAction(action: string): keyof typeof Ionicons.glyphMap {
  switch (action) {
    case 'CREATE':
      return 'add-circle-outline';
    case 'UPDATE':
      return 'create-outline';
    case 'DELETE':
      return 'trash-outline';
    case 'LOGIN':
      return 'log-in-outline';
    case 'LOGOUT':
      return 'log-out-outline';
    case 'PERMISSION_CHANGED':
      return 'key-outline';
    case 'ACTIVATE':
      return 'checkmark-circle-outline';
    case 'DEACTIVATE':
      return 'close-circle-outline';
    default:
      return 'ellipse-outline';
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm },
  welcome: { fontSize: fontSize.sm, color: colors.textSecondary },
  name: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  logRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  logRowBordered: { borderTopWidth: 1, borderTopColor: colors.divider },
  logIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logSummary: { fontSize: fontSize.sm, color: colors.text, lineHeight: 19 },
  logMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});
