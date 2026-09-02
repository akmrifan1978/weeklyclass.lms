import React, { useCallback } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
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
                  {article.title}
                </Text>
                <Text style={styles.byline}>
                  {article.author} · {formatDate(article.publishedAt ?? article.createdAt, language)}
                </Text>

                {article.summary ? (
                  <View style={styles.summaryBox}>
                    <Text style={styles.summary}>{article.summary}</Text>
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
