import React, { useCallback } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatDuration } from '@/utils/date';
import { getLesson, listMaterials } from '@/services/contentService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import { MaterialRow } from '@/components/shared/ContentCards';
import { VideoPlayer } from '@/components/shared/VideoPlayer';
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
                  <VideoPlayer url={lesson.videoUrl} title={lesson.title} />
                  <Spacer />
                </>
              ) : null}

              <Card>
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
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  audioLabel: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  description: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 23,
    marginTop: spacing.lg,
  },
});
