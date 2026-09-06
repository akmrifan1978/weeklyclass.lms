import React, { useCallback, useMemo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import { formatDate } from '@/utils/date';
import * as videoService from '@/services/videoService';
import { listVideosForStudent } from '@/services/videoService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { AyahAudio } from './AyahAudio';
import { TranslationManager } from './TranslationManager';
import type { LanguageCode, VideoItem } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  Screen,
  SearchField,
  SkeletonList,
} from '@/components/ui';

/**
 * Noor ʿalā al-Darb — a curated series of scholarly Q&A episodes.
 *
 * The episodes are added by an administrator, not fetched. There is no open,
 * key-less source for this series, and its content is scholarly rulings: a
 * translation has to be written by someone who knows the material, which is why
 * the translation fields are filled in by hand and fall back to the original
 * rather than being generated.
 *
 * The screen keeps its own language, like the rest of the Islamic sections, and
 * shows the translation for that language beside the Arabic title.
 */
export function NoorScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language, setLanguage } = useLanguageScope('noor');
  const [search, setSearch] = useState('');

  const load = useCallback(
    () => listVideosForStudent(user?.classId ?? null, 'noor', 60),
    [user?.classId]
  );
  const { data, loading, refreshing, error, reload, refresh } = useAsync(load, [load]);

  const episodes = useMemo(
    () =>
      (data ?? []).filter((episode) =>
        matchesSearch(
          search,
          episode.title,
          episode.speaker,
          // The imported archive files each fatwa under an Arabic topic, kept
          // on `venue`. Searching it is how you find "everything about wudu".
          episode.venue,
          translationFor(episode, language).title,
          translationFor(episode, language).summary
        )
      ),
    [data, search, language]
  );

  return (
    <>
      <AppHeader
        title={t('noor.title')}
        subtitle={t('noor.subtitle')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('noor.search')}
        />

        {loading ? (
          <SkeletonList count={5} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : episodes.length === 0 ? (
          <EmptyState
            icon="radio-outline"
            title={t('noor.none')}
            message={t('noor.noneHelp')}
          />
        ) : (
          episodes.map((episode) => (
            <EpisodeCard
              key={episode.id}
              episode={episode}
              language={language}
              onChanged={reload}
            />
          ))
        )}
      </Screen>
    </>
  );
}

/**
 * What a reader sees.
 *
 * Only an approved translation counts. A draft — written but not yet reviewed —
 * is deliberately invisible here; staff see it through the manager below, which
 * is the whole point of having a review step.
 */
function translationFor(
  episode: VideoItem,
  language: LanguageCode
): { title: string; summary: string | undefined } {
  const entry = videoService.publishedTranslation(episode, language);
  return {
    title: entry?.title?.trim() || episode.title,
    summary: entry?.summary?.trim() || episode.description,
  };
}

function EpisodeCard({
  episode,
  language,
  onChanged,
}: {
  episode: VideoItem;
  language: LanguageCode;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const approved = videoService.publishedTranslation(episode, language);
  const shown = translationFor(episode, language);
  // A translation exists only when a person wrote one for THIS language AND an
  // admin approved it. The Arabic is never replaced by a fallback.
  const translated = Boolean(approved?.title || approved?.summary);
  // Staff see the review tools; a draft awaiting review is theirs to see, not
  // the reader's.
  const isStaff = user?.role === 'admin' || user?.role === 'teacher';

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.headerRow}
      >
        {episode.thumbnail ? (
          <Image
            source={{ uri: episode.thumbnail }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Ionicons name="radio" size={20} color={brand.orange} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {shown.title}
          </Text>
          {/* The Arabic original is kept visible under a translated title —
              people search for these episodes by their Arabic name. */}
          {translated && shown.title !== episode.title ? (
            <Text style={styles.original} numberOfLines={1}>
              {episode.title}
            </Text>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {[episode.speaker, episode.date ? formatDate(episode.date) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {episode.venue ? (
            <View style={styles.topicChip}>
              <Text style={styles.topicText} numberOfLines={1}>
                {episode.venue}
              </Text>
            </View>
          ) : null}
        </View>

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {/* The Arabic question is the record; a translation appears beneath
              it only where one has been written and checked for this language.
              Nothing is generated, and nothing from another language stands in. */}
          <Text style={styles.arabicBody} accessibilityLanguage="ar" selectable>
            {episode.title}
          </Text>

          {/*
            Either field counts. These fatwas have no written answer — the
            answer IS the recording — so a translated question with an empty
            summary is the normal shape, and requiring both would have hidden
            every translation of this archive.
          */}
          {translated ? (
            <View style={styles.translationBlock}>
              <Text style={styles.translationLabel}>
                {t('scripture.approvedTranslation', { language })}
              </Text>
              {approved?.title ? (
                <Text style={styles.summary}>{approved.title}</Text>
              ) : null}
              {approved?.summary ? (
                <Text style={[styles.summary, { marginTop: spacing.sm }]}>
                  {approved.summary}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.noSummary}>{t('scripture.noApprovedTranslation')}</Text>
          )}

          {/*
            Played in place, not opened. `Linking.openURL` sent the listener out
            to a bare MP3 page in a new browser tab with no way back to the app —
            which is a poor thing to do to someone who only wanted to hear an
            answer, and worse on a phone where the app may be unloaded behind it.
          */}
          {episode.videoUrl ? (
            <View style={styles.playRow}>
              <AyahAudio url={episode.videoUrl} size={38} />
              <Text style={styles.playLabel}>{t('noor.listen')}</Text>
            </View>
          ) : null}

          {/*
            Attribution, shown because the source requires it. binbaz.org.sa
            permits copying "on condition that the source is cited" — this line
            IS that condition, not a nicety, so it is not hidden behind a tap.
          */}
          {isStaff ? (
            <TranslationManager video={episode} onChanged={onChanged} />
          ) : null}

          {episode.sourceName ? (
            <Pressable
              onPress={() =>
                episode.sourceUrl ? void Linking.openURL(episode.sourceUrl) : undefined
              }
              accessibilityRole={episode.sourceUrl ? 'link' : 'text'}
              accessibilityLabel={t('noor.source', { source: episode.sourceName })}
              style={styles.sourceRow}
            >
              <Ionicons name="link-outline" size={13} color={colors.textMuted} />
              <Text style={styles.source}>
                {t('noor.source', { source: episode.sourceName })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  original: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
    writingDirection: 'rtl',
  },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  topicChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    maxWidth: '100%',
  },
  topicText: { fontSize: fontSize.xs, color: colors.textSecondary },
  body: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  summary: { fontSize: fontSize.sm, lineHeight: 21, color: colors.textSecondary },
  arabicBody: {
    fontSize: 20,
    lineHeight: 40,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  translationBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  playLabel: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  translationLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  noSummary: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.md,
  },
  source: { flex: 1, fontSize: fontSize.xs, color: colors.textMuted },
});
