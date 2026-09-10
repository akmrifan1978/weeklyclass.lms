import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { colors } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import { matchesSearch, truncate } from '@/utils/format';
import { deleteArticle, listArticles, saveArticle } from '@/services/contentService';
import type { Article, ContentStatus, LanguageCode } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { PublishActions } from '@/features/PublishActions';
import { AdminRow } from '@/features/AdminRow';
import { DateField, Select, TextField } from '@/components/ui';

interface ArticleForm {
  title: string;
  summary: string;
  content: string;
  author: string;
  image: string;
  publishedAt: string;
  language: LanguageCode;
  status: ContentStatus;
  isFeatured: boolean;
}

const EMPTY: ArticleForm = {
  title: '',
  summary: '',
  content: '',
  author: '',
  image: '',
  publishedAt: '',
  language: 'en',
  // New work starts as a DRAFT. Something half-written reaching a class
  // before its author meant it to is not recoverable by editing it
  // afterwards — they have already read it.
  status: 'draft',
  isFeatured: false,
};

export function ArticleManager() {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const fetchPage = useCallback(async (cursor: Cursor, search: string) => {
    const page = await listArticles({ cursor, pageSize: 20 });
    return {
      ...page,
      items: search
        ? page.items.filter((a) => matchesSearch(search, a.title, a.summary, a.author))
        : page.items,
    };
  }, []);

  return (
    <CrudScreen<Article, ArticleForm>
      title={t('article.title')}
      addLabel={t('dashboard.addArticle')}
      emptyIcon="newspaper-outline"
      emptyTitle={t('article.noArticles')}
      canCreate={can('MANAGE_ARTICLES')}
      canDelete={can('MANAGE_ARTICLES')}
      fetchPage={fetchPage}
      emptyForm={{ ...EMPTY, author: user?.fullName ?? '' }}
      toForm={(article) => ({
        title: article.title,
        summary: article.summary ?? '',
        content: article.content ?? '',
        author: article.author,
        image: article.image ?? '',
        publishedAt: '',
        language: article.language,
        status: article.status,
        isFeatured: article.isFeatured,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.content.trim()) errors.content = 'validation.fieldRequired';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveArticle(
          {
            title: form.title.trim(),
            summary: form.summary.trim(),
            content: form.content.trim(),
            author: form.author.trim() || user.fullName,
            image: form.image.trim() || null,
            language: form.language,
            status: form.status,
            isFeatured: form.isFeatured,
            publishedAt: form.publishedAt ? new Date(form.publishedAt) : new Date(),
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (article) => {
        if (!user) return;
        await deleteArticle(article.id, user);
      }}
      renderItem={(article, actions) => (
        <AdminRow
          icon={article.isFeatured ? 'star' : 'newspaper-outline'}
          iconTint={article.isFeatured ? colors.accent : colors.primary}
          title={article.title}
          subtitle={article.summary ? truncate(article.summary, 100) : undefined}
          meta={`${article.author} · ${formatShortDate(article.publishedAt ?? article.createdAt)}`}
          badges={[
            { label: t(`common.${article.status}`), tone: article.status },
            ...(article.isFeatured ? [{ label: t('video.featured'), tone: 'active' }] : []),
          ]}
          extraActions={
            <PublishActions
              status={article.status}
              previewUrl={null}
              onSetStatus={async (next) => {
                if (!user) return;
                await saveArticle({ ...article, status: next }, user, article.id);
                actions.reload?.();
              }}
            />
          }
          onEdit={can('MANAGE_ARTICLES') ? actions.edit : undefined}
          onDelete={can('MANAGE_ARTICLES') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('common.title')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="newspaper-outline"
            required
          />
          <TextField
            label={t('article.summary')}
            value={form.summary}
            onChangeText={(v) => set('summary', v)}
            hint={t('article.summary')}
            multiline
          />
          <TextField
            label={t('article.content')}
            value={form.content}
            onChangeText={(v) => set('content', v)}
            error={errors.content}
            hint={t('article.paragraphHint')}
            multiline
            required
          />
          <TextField
            label={t('article.author')}
            value={form.author}
            onChangeText={(v) => set('author', v)}
            icon="person-outline"
          />
          <TextField
            label={t('article.coverImage')}
            value={form.image}
            onChangeText={(v) => set('image', v)}
            icon="image-outline"
            autoCapitalize="none"
          />
          <DateField
            label={t('article.publishedOn')}
            value={form.publishedAt}
            onChange={(v) => set('publishedAt', v)}
          />
          <Select<ContentStatus>
            label={t('common.status')}
            value={form.status}
            options={[
              { value: 'published', label: t('common.published') },
              { value: 'draft', label: t('common.draft') },
              { value: 'archived', label: t('common.archived') },
            ]}
            onChange={(v) => set('status', v)}
          />
          <Select<'yes' | 'no'>
            label={t('article.setFeatured')}
            value={form.isFeatured ? 'yes' : 'no'}
            options={[
              { value: 'no', label: t('common.no') },
              { value: 'yes', label: t('common.yes') },
            ]}
            onChange={(v) => set('isFeatured', v === 'yes')}
          />
        </>
      )}
    />
  );
}
