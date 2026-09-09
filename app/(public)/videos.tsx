import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import {
  ChipRow,
  Fact,
  ListState,
  PublicCard,
  SearchBar,
  Tag,
} from '@/components/public/PublicControls';
import { VideoPlayer } from '@/components/shared/VideoPlayer';
import { useAsync } from '@/hooks/useAsync';
import { autoThumbnail, listPublicVideos } from '@/services/videoService';
import { formatShortDate } from '@/utils/date';
import type { VideoItem } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';

/**
 * The recordings anybody may watch.
 *
 * `listPublicVideos` returns exactly what the security rules already publish to
 * a signed-out reader: released recordings belonging to no particular class.
 * Nothing on this page is a new exposure — it is the same shop window the
 * guest view has always shown, given a page of its own.
 *
 * A talk plays where it sits rather than on a screen of its own. Sending
 * somebody to a detail page to press a second play button is a step that earns
 * nothing, and the player is the same one the app uses everywhere else.
 */
export default function PublicVideos() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [playing, setPlaying] = useState<string | null>(null);

  const load = useCallback(() => listPublicVideos(40).then((page) => page.items), []);
  const { data, loading, refreshing, refresh } = useAsync(load, []);

  /** The categories that actually exist, rather than a fixed list. */
  const topics = useMemo(() => {
    const found = new Set<string>();
    for (const video of data ?? []) if (video.topic?.trim()) found.add(video.topic.trim());
    return [
      { value: 'all', label: t('common.all') },
      ...[...found].sort().map((name) => ({ value: name, label: name })),
    ];
  }, [data, t]);

  const videos = useMemo(() => {
    let rows = data ?? [];
    if (topic !== 'all') rows = rows.filter((video) => video.topic?.trim() === topic);

    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((video) =>
      [video.title, video.description, video.speaker, video.venue, video.topic]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [data, query, topic]);

  return (
    <PublicPage
      badge={t('public.videos.badge')}
      title={t('public.videos.title')}
      subtitle={t('public.videos.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <SearchBar value={query} onChange={setQuery} placeholder={t('public.videos.search')} />
      {topics.length > 1 ? <ChipRow options={topics} value={topic} onChange={setTopic} /> : null}

      <ListState
        loading={loading}
        empty={videos.length === 0}
        icon="videocam-outline"
        title={t('public.videos.emptyTitle')}
        message={t('public.videos.emptyBody')}
      />

      {videos.map((video) => (
        <VideoCard
          key={video.id}
          video={video}
          playing={playing === video.id}
          onPlay={() => setPlaying(playing === video.id ? null : video.id)}
        />
      ))}
    </PublicPage>
  );
}

function VideoCard({
  video,
  playing,
  onPlay,
}: {
  video: VideoItem;
  playing: boolean;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  const poster = autoThumbnail(video.videoUrl, video.thumbnail);
  const facts = [video.speaker, video.venue].filter(Boolean).join('  ·  ');

  return (
    <PublicCard>
      {playing ? (
        <VideoPlayer url={video.videoUrl} title={video.title} />
      ) : (
        <Pressable
          onPress={onPlay}
          accessibilityRole="button"
          accessibilityLabel={t('common.watchNow')}
          style={({ pressed }) => [styles.poster, { opacity: pressed ? 0.9 : 1 }]}
        >
          {poster ? (
            <Image source={{ uri: poster }} style={styles.posterImage} resizeMode="cover" />
          ) : (
            <View style={[styles.posterImage, styles.posterEmpty]} />
          )}
          <View style={styles.playMark}>
            <Ionicons name="play" size={20} color={colors.textOnAccent} />
          </View>
        </Pressable>
      )}

      {video.topic ? <Tag label={video.topic} /> : null}

      <Text style={styles.title} numberOfLines={2}>
        {video.title}
      </Text>

      {facts ? <Fact icon="person-outline" text={facts} /> : null}
      {video.date ? <Fact icon="calendar-outline" text={formatShortDate(video.date)} /> : null}

      {video.description ? (
        <Text style={styles.blurb} numberOfLines={3}>
          {video.description}
        </Text>
      ) : null}
    </PublicCard>
  );
}

const styles = StyleSheet.create({
  poster: {
    height: 170,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: brand.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  posterEmpty: { backgroundColor: brand.navy },
  playMark: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: brand.orange,
    alignItems: 'center',
    justifyContent: 'center',
    // Nudged, because a play triangle centred by its bounding box reads as
    // sitting left of centre inside a circle.
    paddingLeft: 3,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: brand.navyDeep,
    lineHeight: 21,
  },
  blurb: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
});
