import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { formatShortDate, toDate } from '@/utils/date';
import { listVideosForStudent } from '@/services/videoService';
import { listKhutbahs } from '@/services/khutbahService';
import { lessonsForStudent } from '@/services/contentService';
import { VideoRow } from '@/components/shared/ContentCards';
import type { FireDate, KhutbahEntry, Lesson, VideoItem } from '@/types';
import {
  AppHeader,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';

/**
 * Everything recently released, in one place.
 *
 * "New" means published within the last fortnight, split out from the rest so
 * the answer to "has anything come out since I last looked?" is the first thing
 * on screen. Everything else follows underneath rather than being hidden — a
 * two-week cutoff on an empty week would otherwise leave the screen blank.
 *
 * NOT ONLY RECORDINGS any more. This screen used to read the recordings
 * collection alone, and this centre publishes its talks as Special Bayan &
 * Khutbah entries and its weekly teaching as lessons — so a khutbah and three
 * lesson videos could be released and New Releases would still announce that
 * nothing existed. A release is a release, whichever collection holds it.
 */
const NEW_FOR_DAYS = 14;

type Release =
  | { kind: 'video'; id: string; posted: number; item: VideoItem }
  | { kind: 'khutbah'; id: string; posted: number; item: KhutbahEntry }
  | { kind: 'lesson'; id: string; posted: number; item: Lesson };

function time(value: FireDate | string | undefined | null): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return toDate(value)?.getTime() ?? 0;
}

export function NewReleasesScreen({ basePath }: { basePath: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();

  const isStudent = user?.role === 'student';

  const load = useCallback(async (): Promise<Release[]> => {
    /*
     * All three at once — none depends on another. Each is allowed to fail on
     * its own: a refused khutbah read must not take the recordings down with
     * it, because an empty screen reads as "nothing was released".
     */
    const [videos, khutbahs, lessons] = await Promise.all([
      listVideosForStudent(user?.classId ?? null, 'video', 40).catch(() => [] as VideoItem[]),
      listKhutbahs({ publishedOnly: true, pageSize: 20 }).catch(() => [] as KhutbahEntry[]),
      // Lessons belong to a class, so only a student has "their" lessons to
      // show, and only students have a lesson screen to open them in.
      isStudent && user?.classId
        ? lessonsForStudent(user.classId, 20).then((p) => p.items).catch(() => [] as Lesson[])
        : Promise.resolve([] as Lesson[]),
    ]);

    const releases: Release[] = [
      // Posting is what makes something new to the reader, so createdAt wins
      // over the date the session happened.
      ...videos.map((item) => ({
        kind: 'video' as const,
        id: item.id,
        posted: time(item.createdAt ?? item.date),
        item,
      })),
      ...khutbahs.map((item) => ({
        kind: 'khutbah' as const,
        id: item.id,
        posted: time(item.createdAt ?? item.date),
        item,
      })),
      ...lessons
        .filter((item) => item.status === 'published')
        .map((item) => ({
          kind: 'lesson' as const,
          id: item.id,
          posted: time(item.publishDate ?? item.createdAt),
          item,
        })),
    ];
    return releases.sort((a, b) => b.posted - a.posted);
  }, [isStudent, user?.classId]);

  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const { fresh, older } = useMemo(() => {
    const cutoff = Date.now() - NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
    const all = data ?? [];
    return {
      fresh: all.filter((r) => r.posted >= cutoff),
      older: all.filter((r) => r.posted < cutoff),
    };
  }, [data]);

  const renderRelease = (release: Release) => {
    if (release.kind === 'video') {
      return (
        <VideoRow
          video={release.item}
          onPress={() => router.push(`${basePath}/video/${release.id}` as never)}
        />
      );
    }
    const isKhutbah = release.kind === 'khutbah';
    const title = release.item.title;
    const kindLabel = isKhutbah
      ? t(`khutbah.kind_${(release.item as KhutbahEntry).kind}`)
      : t('lesson.title');
    const who = isKhutbah
      ? (release.item as KhutbahEntry).speaker
      : (release.item as Lesson).speaker;
    const target = isKhutbah ? `${basePath}/khutbah` : `${basePath}/lesson/${release.id}`;

    return (
      <Pressable
        onPress={() => router.push(target as never)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Card style={styles.row}>
          <View style={[styles.rowIcon, isKhutbah ? styles.rowIconKhutbah : styles.rowIconLesson]}>
            <Ionicons
              name={isKhutbah ? 'mic-outline' : 'book-outline'}
              size={20}
              color={colors.textInverse}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowKind}>{kindLabel}</Text>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {[who, release.posted ? formatShortDate(new Date(release.posted)) : null]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      </Pressable>
    );
  };

  return (
    <>
      <AppHeader title={t('video.newReleases')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {loading ? (
          <SkeletonList count={4} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="videocam-outline"
            title={t('video.noRecordings')}
            message={t('video.noRecordingsHelp')}
          />
        ) : (
          <>
            {fresh.length ? (
              <>
                <Card style={styles.banner}>
                  <Ionicons name="sparkles" size={18} color={brand.orange} />
                  <Text style={styles.bannerText}>
                    {t('video.newThisFortnight', { count: fresh.length })}
                  </Text>
                </Card>
                {fresh.map((release) => (
                  <View key={`${release.kind}-${release.id}`} style={styles.freshWrap}>
                    <View style={styles.newTag}>
                      <Text style={styles.newTagText}>{t('video.new')}</Text>
                    </View>
                    {renderRelease(release)}
                  </View>
                ))}
              </>
            ) : (
              <Card style={styles.banner}>
                <Ionicons name="time-outline" size={18} color={colors.textMuted} />
                <Text style={styles.bannerText}>{t('video.nothingNew')}</Text>
              </Card>
            )}

            {older.length ? (
              <>
                <SectionHeader title={t('video.earlier')} icon="albums-outline" />
                {older.map((release) => (
                  <View key={`${release.kind}-${release.id}`}>{renderRelease(release)}</View>
                ))}
              </>
            ) : null}
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  bannerText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  freshWrap: { position: 'relative' },
  newTag: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
    backgroundColor: brand.orange,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  newTagText: {
    fontSize: fontSize.xs,
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconKhutbah: { backgroundColor: brand.navy },
  rowIconLesson: { backgroundColor: brand.orange },
  rowKind: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowTitle: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  rowMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
});
