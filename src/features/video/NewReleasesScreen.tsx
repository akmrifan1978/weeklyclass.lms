import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { toDate } from '@/utils/date';
import { listVideosForStudent } from '@/services/videoService';
import { VideoRow } from '@/components/shared/ContentCards';
import type { VideoItem } from '@/types';
import {
  AppHeader,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';

/**
 * Recently published recordings.
 *
 * "New" means published within the last fortnight, split out from the rest so
 * the answer to "has anything come out since I last looked?" is the first thing
 * on screen. Everything else follows underneath rather than being hidden — a
 * two-week cutoff on an empty week would otherwise leave the screen blank.
 */
const NEW_FOR_DAYS = 14;

export function NewReleasesScreen({ basePath }: { basePath: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();

  const load = useCallback(
    () => listVideosForStudent(user?.classId ?? null, 'video', 40),
    [user?.classId]
  );
  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const { fresh, older } = useMemo(() => {
    const cutoff = Date.now() - NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
    const isFresh = (video: VideoItem) => {
      // `date` is when the session happened; createdAt is when it was posted.
      // Posting is what makes it new to the student, so that is the one used.
      const posted = toDate(video.createdAt ?? video.date)?.getTime();
      return typeof posted === 'number' && posted >= cutoff;
    };
    return {
      fresh: (data ?? []).filter(isFresh),
      older: (data ?? []).filter((v) => !isFresh(v)),
    };
  }, [data]);

  return (
    <>
      <AppHeader title={t('video.newReleases')} showBack />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {loading ? (
          <SkeletonList count={4} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
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
                {fresh.map((video) => (
                  <View key={video.id} style={styles.freshWrap}>
                    <View style={styles.newTag}>
                      <Text style={styles.newTagText}>{t('video.new')}</Text>
                    </View>
                    <VideoRow
                      video={video}
                      onPress={() => router.push(`${basePath}/video/${video.id}` as never)}
                    />
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
                {older.map((video) => (
                  <VideoRow
                    key={video.id}
                    video={video}
                    onPress={() => router.push(`${basePath}/video/${video.id}` as never)}
                  />
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
});
