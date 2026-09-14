import React, { useCallback } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatDuration } from '@/utils/date';
import { getVideo } from '@/services/videoService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import { VideoPlayer } from '@/components/shared/VideoPlayer';
import {
  AppHeader,
  AsyncBoundary,
  Button,
  Card,
  DetailRow,
  Divider,
  Screen,
  SkeletonList,
  Spacer,
} from '@/components/ui';
import { LogoImage } from '@/components/shared/AppLogo';

export default function VideoDetail() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(async () => {
    if (!id) return null;
    const video = await getVideo(id);
    if (video) logEvent(AnalyticsEvents.videoPlayed, { videoId: video.id });
    return video;
  }, [id]);

  const { data: video, loading, error, reload } = useAsync(load, [id]);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={video?.title ?? t('video.title')}
        subtitle={video?.speaker}
        showBack
      />

      <Screen>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={!video}
          onRetry={reload}
          skeleton={<SkeletonList count={2} />}
          emptyProps={{ icon: 'videocam-outline', title: t('errors.notFound') }}
        >
          {video ? (
            <>
              {video.bannerUrl ? (
                <>
                  <Image
                    source={{ uri: video.bannerUrl }}
                    style={styles.banner}
                    resizeMode="cover"
                    accessibilityLabel={t('video.banner')}
                  />
                  <Spacer size={spacing.md} />
                </>
              ) : null}

              <VideoPlayer url={video.videoUrl} title={video.title} />
              <Spacer />

              <Card>
                <View style={styles.titleRow}>
                  {video.logoUrl ? (
                    <LogoImage
                      uri={video.logoUrl}
                      size={48}
                      style={styles.logo}
                      accessibilityLabel={t('video.logo')}
                    />
                  ) : null}
                  <Text style={[styles.title, styles.titleFlex]}>{video.title}</Text>
                </View>
                {video.description ? (
                  <Text style={styles.description}>{video.description}</Text>
                ) : null}
              </Card>

              <Spacer />

              <Card>
                {video.speaker ? (
                  <>
                    <DetailRow
                      label={t('video.speaker')}
                      value={video.speaker}
                      icon="mic-outline"
                    />
                    <Divider />
                  </>
                ) : null}
                {video.venue ? (
                  <>
                    <DetailRow
                      label={t('video.venue')}
                      value={video.venue}
                      icon="location-outline"
                    />
                    <Divider />
                  </>
                ) : null}
                <DetailRow
                  label={t('common.date')}
                  value={formatDate(video.date ?? video.createdAt, language)}
                  icon="calendar-outline"
                />
                {video.duration ? (
                  <>
                    <Divider />
                    <DetailRow
                      label={t('video.duration')}
                      value={formatDuration(video.duration)}
                      icon="time-outline"
                    />
                  </>
                ) : null}
                <Divider />
                <DetailRow
                  label={t('common.language')}
                  value={video.language.toUpperCase()}
                  icon="language-outline"
                />
              </Card>

              <Spacer />
              <Button
                label={t('video.openExternally')}
                icon="open-outline"
                variant="outline"
                fullWidth
                onPress={() => Linking.openURL(video.videoUrl).catch(() => undefined)}
              />
              <Spacer size={spacing.xxxl} />
            </>
          ) : null}
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleFlex: { flex: 1 },
  banner: {
    width: '100%',
    height: 130,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  logo: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  description: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 23,
    marginTop: spacing.md,
  },
});
