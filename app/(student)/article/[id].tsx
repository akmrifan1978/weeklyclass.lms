import React, { useCallback } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { useAutoTranslate } from '@/hooks/useAutoTranslate';
import { formatDate } from '@/utils/date';
import { getArticle } from '@/services/contentService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import {
  AppHeader,
  AsyncBoundary,
  Card,
  Screen,
  SkeletonList,
  Spacer,
} from '@/components/ui';

export default function ArticleDetail() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(async () => {
    if (!id) return null;
    const article = await getArticle(id);
    if (article) logEvent(AnalyticsEvents.articleRead, { articleId: article.id });
    return article;
  }, [id]);

  const { data: article, loading, error, reload } = useAsync(load, [id]);

  /*
   * Read in the reader's own language.
   *
   * Title, summary and body are translated separately rather than as one
   * blob: they are cached separately too, so an article whose body somebody
   * has already read costs nothing when a second person opens it, and a
   * failure on the long part still leaves the heading readable.
   */
  const title = useAutoTranslate(article?.title, article?.language);
  const summary = useAutoTranslate(article?.summary, article?.language);
  const body = useAutoTranslate(article?.content, article?.language);
  const machine = title.translated || summary.translated || body.translated;

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('article.title')} showBack />

      <Screen>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={!article}
          onRetry={reload}
          skeleton={<SkeletonList count={3} />}
          emptyProps={{ icon: 'newspaper-outline', title: t('errors.notFound') }}
        >
          {article ? (
            <>
              {article.image ? (
                <Image source={{ uri: article.image }} style={styles.cover} resizeMode="cover" />
              ) : null}

              <Card style={article.image ? styles.cardOverlap : undefined}>
                <Text style={styles.title} accessibilityRole="header">
                  {title.text}
                </Text>
                <Text style={styles.byline}>
                  {article.author} · {formatDate(article.publishedAt ?? article.createdAt, language)}
                </Text>

                {/* Said plainly, and never presented as an approved
                    translation. Software did this, not a person, and a reader
                    quoting it should know that before they do. */}
                {machine ? (
                  <View style={styles.machineNote}>
                    <Ionicons name="language-outline" size={14} color={colors.info} />
                    <Text style={styles.machineText}>{t('article.machineTranslated')}</Text>
                  </View>
                ) : null}

                {body.busy ? <Text style={styles.machineText}>{t('common.loading')}</Text> : null}

                {summary.text ? (
                  <View style={styles.summaryBox}>
                    <Text style={styles.summary}>{summary.text}</Text>
                  </View>
                ) : null}

                {/* Content is authored as plain text with blank-line paragraphs. */}
                {article.content
                  .split(/\n{2,}/)
                  .filter((paragraph) => paragraph.trim())
                  .map((paragraph, index) => (
                    <Text key={index} style={styles.paragraph} selectable>
                      {paragraph.trim()}
                    </Text>
                  ))}
              </Card>

              <Spacer size={spacing.xxxl} />
            </>
          ) : null}
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  machineNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.infoSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  machineText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  cover: {
    width: '100%',
    height: 200,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  cardOverlap: { marginTop: -spacing.xxl, marginHorizontal: spacing.sm },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    lineHeight: 32,
  },
  byline: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  summaryBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  summary: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 22,
    fontWeight: fontWeight.medium,
  },
  paragraph: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 25,
    marginTop: spacing.lg,
  },
});
