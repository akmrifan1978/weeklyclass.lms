import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import { listPublicVideos } from '@/services/videoService';
import { listArticles } from '@/services/contentService';
import type { Article, VideoItem } from '@/types';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
} from '@/components/ui';

/**
 * The shop window: what somebody can see before they have an account.
 *
 * Deliberately narrow. Newly released talks, recordings and articles — the
 * things this platform publishes to the world anyway — and nothing else. No
 * class, no lesson, no assignment, no other person's name. Somebody deciding
 * whether this is for them can look first and hand over a phone number
 * afterwards.
 *
 * Nobody signs in for this, not even anonymously. The security rules allow a
 * signed-out read of exactly what is published and unscoped, so the narrowness
 * is enforced where it matters rather than by this screen being the only door.
 */
export default function GuestScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const load = useCallback(async () => {
    const [videos, articles] = await Promise.all([
      listPublicVideos(12).then((p) => p.items).catch(() => [] as VideoItem[]),
      listArticles({ status: 'published', pageSize: 8 })
        .then((p) => p.items)
        .catch(() => [] as Article[]),
    ]);
    return { videos, articles };
  }, []);

  const { data, loading, refreshing, refresh } = useAsync(load, []);
  const nothing =
    !loading &&
    (data?.videos.length ?? 0) === 0 && (data?.articles.length ?? 0) === 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.bar}>
        <IconButton
          icon="chevron-back"
          label={t('common.back')}
          onPress={() => router.back()}
          background="rgba(255,255,255,0.12)"
          color={colors.textInverse}
        />
        <Text style={styles.barTitle} numberOfLines={1} accessibilityRole="header">
          {t('guest.title')}
        </Text>
      </View>

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Text style={styles.lead}>{t('guest.lead')}</Text>

        {loading ? (
          <SkeletonList count={3} />
        ) : nothing ? (
          <EmptyState icon="cloud-outline" title={t('guest.empty')} message={t('guest.emptyHelp')} />
        ) : (
          <>
            <MediaSection
              title={t('video.newReleases')}
              icon="sparkles-outline"
              items={data?.videos ?? []}
            />

            {(data?.articles.length ?? 0) > 0 ? (
              <>
                <Spacer size={spacing.xl} />
                <SectionHeader title={t('nav.articles')} icon="newspaper-outline" />
                {data?.articles.map((article) => (
                  <Card key={article.id} style={styles.row}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {article.title}
                    </Text>
                    {article.summary ? (
                      <Text style={styles.rowBody} numberOfLines={3}>
                        {article.summary}
                      </Text>
                    ) : null}
                    <Text style={styles.rowFact}>
                      {article.author}
                      {article.publishedAt ? `  ·  ${formatShortDate(article.publishedAt)}` : ''}
                    </Text>
                  </Card>
                ))}
              </>
            ) : null}
          </>
        )}

        <Spacer size={spacing.xxl} />

        {/* The point of the window is the door beside it. */}
        <Card style={styles.joinCard}>
          <Text style={styles.joinTitle}>{t('guest.joinTitle')}</Text>
          <Text style={styles.joinBody}>{t('guest.joinBody')}</Text>
          <Button
            label={t('auth.register')}
            icon="person-add-outline"
            fullWidth
            onPress={() => router.push('/(auth)/register')}
          />
        </Card>
      </Screen>
    </SafeAreaView>
  );
}

function MediaSection({
  title,
  icon,
  items,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: VideoItem[];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <Spacer size={spacing.xl} />
      <SectionHeader title={title} icon={icon} />
      {items.map((item) => (
        <Card key={item.id} style={styles.row}>
          <View style={styles.mediaRow}>
            <View style={styles.playMark}>
              <Ionicons name="play" size={14} color={brand.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.rowFact} numberOfLines={1}>
                {[item.speaker, item.venue].filter(Boolean).join('  ·  ') ||
                  formatShortDate(item.date)}
              </Text>
            </View>
          </View>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.navyDeep },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  barTitle: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  lead: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 21 },
  row: { marginTop: spacing.md },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  playMark: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  rowBody: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18, marginTop: 4 },
  rowFact: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
  joinCard: { alignItems: 'flex-start', gap: spacing.sm },
  joinTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  joinBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
});
