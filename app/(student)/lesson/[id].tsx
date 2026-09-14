import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatDuration } from '@/utils/date';
import { getLesson, listMaterials } from '@/services/contentService';
import { watchSettings } from '@/services/settingsService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import { MaterialRow } from '@/components/shared/ContentCards';
import { VideoPlayer } from '@/components/shared/VideoPlayer';
import { RatingPrompt } from '@/components/shared/RatingPrompt';
import { AyahAudio } from '@/features/islamic/AyahAudio';
import {
  AppHeader,
  AsyncBoundary,
  Badge,
  Button,
  Card,
  DetailRow,
  Divider,
  Screen,
  SectionHeader,
  SkeletonList,
  Spacer,
} from '@/components/ui';

export default function LessonDetail() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(async () => {
    if (!id) return null;
    const [lesson, materials] = await Promise.all([
      getLesson(id),
      listMaterials({ lessonId: id, pageSize: 20 }).then((p) => p.items).catch(() => []),
    ]);
    if (lesson) logEvent(AnalyticsEvents.lessonOpened, { lessonId: lesson.id });
    return { lesson, materials };
  }, [id]);

  const { data, loading, error, reload, refreshing, refresh } = useAsync(load, [id]);
  const lesson = data?.lesson;

  // The centre's CURRENT logo, live. Unlike a recording, a lesson does not
  // carry a copy of the branding it went out with, so this follows whatever
  // the admin has set — and changes with it.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => watchSettings((settings) => setLogoUrl(settings.logoUrl?.trim() || null)), []);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={lesson?.title ?? t('lesson.title')}
        subtitle={lesson ? t('lesson.week', { number: lesson.weekNumber }) : undefined}
        showBack
      />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={!lesson}
          onRetry={reload}
          skeleton={<SkeletonList count={3} />}
          emptyProps={{ icon: 'book-outline', title: t('errors.notFound') }}
        >
          {lesson ? (
            <>
              {lesson.videoUrl ? (
                <>
                  <View style={styles.playerWrap}>
                    <VideoPlayer url={lesson.videoUrl} title={lesson.title} />
                    {/* In the top corner, over the picture, the way a broadcaster
                        marks its feed. It ignores touches so it can never sit on
                        top of a control somebody is reaching for. */}
                    {logoUrl ? (
                      <View pointerEvents="none" style={styles.logoBadge}>
                        <Image
                          source={{ uri: logoUrl }}
                          style={styles.logoImage}
                          resizeMode="contain"
                          accessibilityLabel={t('video.logo')}
                        />
                      </View>
                    ) : null}
                  </View>
                  <Spacer />
                </>
              ) : null}

              <Card>
                {/* No video to mark, so the logo sits in the corner of the
                    content itself instead. */}
                {!lesson.videoUrl && logoUrl ? (
                  <Image
                    source={{ uri: logoUrl }}
                    style={styles.cardLogo}
                    resizeMode="contain"
                    accessibilityLabel={t('video.logo')}
                  />
                ) : null}
                <Text style={styles.title}>{lesson.title}</Text>
                <View style={styles.badges}>
                  <Badge label={t('lesson.week', { number: lesson.weekNumber })} tone="active" />
                  {lesson.subject ? <Badge label={lesson.subject} /> : null}
                  {lesson.duration ? <Badge label={formatDuration(lesson.duration)} /> : null}
                </View>
                {lesson.description ? (
                  <Text style={styles.description}>{lesson.description}</Text>
                ) : null}
              </Card>

              <Spacer />

              <Card>
                {lesson.speaker ? (
                  <>
                    <DetailRow label={t('video.speaker')} value={lesson.speaker} icon="mic-outline" />
                    <Divider />
                  </>
                ) : null}
                {lesson.venue ? (
                  <>
                    <DetailRow label={t('video.venue')} value={lesson.venue} icon="location-outline" />
                    <Divider />
                  </>
                ) : null}
                <DetailRow
                  label={t('lesson.publishDate')}
                  value={formatDate(lesson.publishDate ?? lesson.createdAt, language)}
                  icon="calendar-outline"
                />
                <Divider />
                <DetailRow
                  label={t('common.language')}
                  value={lesson.language.toUpperCase()}
                  icon="language-outline"
                />
              </Card>

              {lesson.audioUrl || lesson.pdfUrl ? (
                <>
                  <Spacer />
                  <SectionHeader title={t('lesson.attachments')} icon="attach-outline" />
                  <View style={{ gap: spacing.md }}>
                    {/* Audio plays in place. Opening it sent the student to a
                        bare media page in another tab with no way back to the
                        lesson they were part-way through. A PDF is different —
                        it genuinely belongs in a viewer — so that one still
                        opens outside. */}
                    {lesson.audioUrl ? (
                      <View style={styles.audioRow}>
                        <AyahAudio url={lesson.audioUrl} size={38} />
                        <Text style={styles.audioLabel}>{t('lesson.audio')}</Text>
                      </View>
                    ) : null}
                    {lesson.pdfUrl ? (
                      <Button
                        label={t('lesson.pdf')}
                        icon="document-text-outline"
                        variant="outline"
                        fullWidth
                        onPress={() => Linking.openURL(lesson.pdfUrl!).catch(() => undefined)}
                      />
                    ) : null}
                  </View>
                </>
              ) : null}

              {data?.materials.length ? (
                <>
                  <Spacer />
                  <SectionHeader title={t('material.title')} icon="folder-open-outline" />
                  <View style={{ gap: spacing.md }}>
                    {data.materials.map((material) => (
                      <MaterialRow
                        key={material.id}
                        material={material}
                        onPress={() => {
                          logEvent(AnalyticsEvents.materialDownloaded, { materialId: material.id });
                          Linking.openURL(material.url).catch(() => undefined);
                        }}
                      />
                    ))}
                  </View>
                </>
              ) : null}

              <Spacer size={spacing.xxxl} />
            </>
          ) : null}

          {/* After the lesson, not before it. A rating asked above the
              material is a rating of a page nobody has read yet. */}
          {lesson ? (
            <RatingPrompt target="lesson" targetId={lesson.id} targetTitle={lesson.title} />
          ) : null}
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  audioLabel: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  playerWrap: { position: 'relative' },
  logoBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  logoImage: { width: 40, height: 40 },
  cardLogo: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 36,
    height: 36,
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  description: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 23,
    marginTop: spacing.lg,
  },
});
