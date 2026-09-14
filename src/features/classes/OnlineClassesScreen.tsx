import React, { useCallback, useMemo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as calendar from '@/services/calendarService';
import { listClasses } from '@/services/orgService';
import { listUsers } from '@/services/userService';
import type { AppUser, CalendarEvent, ClassRoom } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';
import { LogoImage } from '@/components/shared/AppLogo';

/**
 * Online classes, for whoever is attending them.
 *
 * Sessions are grouped by date and each one says whether it can be joined yet,
 * because "is this on now?" is the only question anyone opens this screen to
 * answer. Several classes can run at the same hour — a beginners' session and an
 * adults' session in parallel is the normal case here, not an edge one — so
 * nothing assumes one session per slot.
 */
export function OnlineClassesScreen({
  /** Restrict to one class. Students pass their own; staff see everything. */
  classId,
}: {
  classId?: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const load = useCallback(async () => {
    const [sessions, classes, teachers] = await Promise.all([
      calendar.listOnlineClasses(classId ? { classId } : {}),
      listClasses({ pageSize: 100 })
        .then((page) => page.items)
        .catch(() => [] as ClassRoom[]),
      listUsers({ role: 'teacher', status: 'active', pageSize: 200 })
        .then((page) => page.items)
        .catch(() => [] as AppUser[]),
    ]);
    return { sessions, classes, teachers };
  }, [classId]);

  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const classNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const room of data?.classes ?? []) map[room.id] = room.name;
    return map;
  }, [data?.classes]);

  const teacherNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const teacher of data?.teachers ?? []) map[teacher.uid] = teacher.fullName;
    return map;
  }, [data?.teachers]);

  const byDate = useMemo(
    () => calendar.groupByDate(data?.sessions ?? []),
    [data?.sessions]
  );

  const join = async (event: CalendarEvent) => {
    if (!event.meetingUrl) return;
    try {
      await Linking.openURL(event.meetingUrl);
    } catch {
      toast.error(t('onlineClass.couldNotOpen'));
    }
  };

  return (
    <>
      <AppHeader title={t('nav.onlineClasses')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {loading ? (
          <SkeletonList count={4} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (data?.sessions.length ?? 0) === 0 ? (
          <EmptyState
            icon="videocam-outline"
            title={t('onlineClass.none')}
            message={t('onlineClass.noneHelp')}
          />
        ) : (
          Object.entries(byDate).map(([date, sessions]) => (
            <View key={date}>
              <SectionHeader title={date} icon="calendar-outline" />
              {sessions.map((event) => (
                <SessionCard
                  key={event.id}
                  event={event}
                  className={event.classId ? classNames[event.classId] : undefined}
                  teachers={calendar
                    .teachersFor(event)
                    .map((id) => teacherNames[id])
                    .filter(Boolean)}
                  onJoin={() => join(event)}
                />
              ))}
            </View>
          ))
        )}
      </Screen>
    </>
  );
}

function SessionCard({
  event,
  className,
  teachers,
  onJoin,
}: {
  event: CalendarEvent;
  className?: string;
  /** Everyone conducting the session, resolved to names. */
  teachers: string[];
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  const state = calendar.joinWindow(event);

  return (
    <Card style={styles.card}>
      {/*
        Branding is whatever the session was announced with, copied onto the
        event when it was created — so a session keeps the identity it was
        published under even after the platform defaults change.
      */}
      {event.bannerUrl ? (
        <Image
          source={{ uri: event.bannerUrl }}
          style={styles.banner}
          resizeMode="cover"
          accessibilityLabel={event.title}
        />
      ) : null}

      <View style={styles.headerRow}>
        {event.logoUrl ? (
          <LogoImage uri={event.logoUrl} size={40} style={styles.logo} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={styles.time}>
            {event.startTime} – {event.endTime}
            {className ? ` · ${className}` : ''}
          </Text>
        </View>
        {state === 'live' ? (
          <View style={styles.liveChip}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{t('onlineClass.live')}</Text>
          </View>
        ) : null}
      </View>

      {/* Every teacher conducting it, not just the first. Two names is the
          normal case here, and showing one would misrepresent the session. */}
      {teachers.length || event.speaker ? (
        <Text style={styles.meta}>
          <Ionicons
            name={teachers.length > 1 ? 'people-outline' : 'person-outline'}
            size={12}
          />{' '}
          {teachers.length ? teachers.join(' · ') : event.speaker}
        </Text>
      ) : null}

      {/* Venue and location are shown separately: one names the room, the
          other places it, and a reader wants whichever applies to them. */}
      {event.venue || event.location ? (
        <Text style={styles.meta}>
          <Ionicons name="location-outline" size={12} />{' '}
          {[event.venue, event.location].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {event.topic ? (
        <View style={styles.topicChip}>
          <Text style={styles.topicText} numberOfLines={1}>
            {event.topic}
          </Text>
        </View>
      ) : null}

      {event.description ? (
        <Text style={styles.description} numberOfLines={3}>
          {event.description}
        </Text>
      ) : null}

      <Button
        label={t(state === 'live' ? 'onlineClass.joinNow' : 'onlineClass.join')}
        icon="videocam"
        onPress={onJoin}
        // Not disabled before the window opens. Some people want to test their
        // connection an hour early, and a button that refuses is more annoying
        // than a waiting room.
        variant={state === 'live' ? 'primary' : 'outline'}
        fullWidth
        style={{ marginTop: spacing.md }}
      />

      {event.meetingId ? (
        <View style={styles.credentials}>
          <Text style={styles.credentialLabel}>{t('onlineClass.meetingId')}</Text>
          <Text style={styles.credentialValue} selectable>
            {event.meetingId}
          </Text>
        </View>
      ) : null}
      {event.meetingPasscode ? (
        <View style={styles.credentials}>
          <Text style={styles.credentialLabel}>{t('onlineClass.passcode')}</Text>
          <Text style={styles.credentialValue} selectable>
            {event.meetingPasscode}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, overflow: 'hidden' },
  banner: {
    width: '100%',
    height: 110,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: { width: 40, height: 40, borderRadius: radius.sm },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  time: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: brand.red },
  liveText: { fontSize: fontSize.xs, color: brand.red, fontWeight: fontWeight.bold },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.sm },
  topicChip: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    maxWidth: '100%',
  },
  topicText: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.semibold },
  description: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  credentials: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  credentialLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  credentialValue: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
});
