import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import {
  clearFeatured,
  deleteVideo,
  listVideos,
  saveVideo,
  setFeatured,
} from '@/services/videoService';
import { listClasses } from '@/services/orgService';
import type { ContentStatus, LanguageCode, VideoItem, VideoKind } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { DateField, IconButton, Select, TextField, type Option } from '@/components/ui';

interface VideoForm {
  title: string;
  description: string;
  speaker: string;
  videoUrl: string;
  thumbnail: string;
  duration: string;
  date: string;
  classId: string;
  language: LanguageCode;
  status: ContentStatus;
  isFeatured: boolean;
}

const EMPTY: VideoForm = {
  title: '',
  description: '',
  speaker: '',
  videoUrl: '',
  thumbnail: '',
  duration: '',
  date: '',
  classId: '',
  language: 'en',
  status: 'published',
  isFeatured: false,
};

/**
 * Videos and class recordings. `kind` selects which of the two this screen
 * manages; they share a collection so a recording can be promoted to a featured
 * release without moving data.
 */
export function VideoManager({
  kind = 'video',
  classScope,
}: {
  kind?: VideoKind;
  classScope?: string[];
}) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();

  const loadClasses = useCallback(async () => {
    const page = await listClasses({ pageSize: 100 });
    return classScope ? page.items.filter((c) => classScope.includes(c.id)) : page.items;
  }, [classScope]);

  const { data: classes } = useAsync(loadClasses, [classScope?.join(',')]);

  const classOptions = useMemo<Option[]>(
    () => (classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  const fetchPage = useCallback(
    async (cursor: Cursor, search: string) => {
      const page = await listVideos({ kind, cursor, pageSize: 20 });
      const scoped = classScope
        ? page.items.filter((v) => !v.classId || classScope.includes(v.classId))
        : page.items;
      return {
        ...page,
        items: search
          ? scoped.filter((v) => matchesSearch(search, v.title, v.speaker, v.description))
          : scoped,
      };
    },
    [kind, classScope]
  );

  const handleToggleFeatured = async (video: VideoItem, reload: () => void) => {
    if (!user) return;
    try {
      if (video.isFeatured) await clearFeatured(video.id, user);
      else await setFeatured(video.id, user);
      toast.success(t('common.success'));
      reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    }
  };

  return (
    <CrudScreen<VideoItem, VideoForm>
      title={kind === 'recording' ? t('video.recordings') : t('video.title')}
      addLabel={t('dashboard.addVideo')}
      emptyIcon="videocam-outline"
      emptyTitle={kind === 'recording' ? t('video.noRecordings') : t('video.noVideos')}
      canCreate={can('UPLOAD_VIDEO')}
      canDelete={can('DELETE_VIDEO')}
      deps={[kind, classScope?.join(',')]}
      fetchPage={fetchPage}
      emptyForm={EMPTY}
      toForm={(video) => ({
        title: video.title,
        description: video.description ?? '',
        speaker: video.speaker ?? '',
        videoUrl: video.videoUrl,
        thumbnail: video.thumbnail ?? '',
        duration: video.duration ? String(video.duration) : '',
        date: '',
        classId: video.classId ?? '',
        language: video.language,
        status: video.status,
        isFeatured: video.isFeatured,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.videoUrl.trim()) errors.videoUrl = 'validation.invalidUrl';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveVideo(
          {
            title: form.title.trim(),
            description: form.description.trim(),
            speaker: form.speaker.trim(),
            videoUrl: form.videoUrl.trim(),
            thumbnail: form.thumbnail.trim() || null,
            duration: form.duration ? Number(form.duration) : undefined,
            date: form.date ? new Date(form.date) : new Date(),
            classId: form.classId || null,
            language: form.language,
            status: form.status,
            isFeatured: form.isFeatured,
            kind,
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (video) => {
        if (!user) return;
        await deleteVideo(video.id, user);
      }}
      renderItem={(video, actions) => (
        <AdminRow
          icon={video.isFeatured ? 'star' : 'videocam-outline'}
          iconTint={video.isFeatured ? colors.accent : colors.primary}
          title={video.title}
          subtitle={video.speaker || undefined}
          meta={formatShortDate(video.date ?? video.createdAt)}
          badges={[
            { label: t(`common.${video.status}`), tone: video.status },
            ...(video.isFeatured ? [{ label: t('video.featured'), tone: 'active' }] : []),
          ]}
          extraActions={
            kind === 'video' && can('UPLOAD_VIDEO') ? (
              <IconButton
                icon={video.isFeatured ? 'star' : 'star-outline'}
                label={t(video.isFeatured ? 'video.unsetFeatured' : 'video.setFeatured')}
                size={36}
                color={colors.accent}
                background={colors.accentSoft}
                onPress={() => handleToggleFeatured(video, actions.edit)}
              />
            ) : undefined
          }
          onEdit={can('UPLOAD_VIDEO') ? actions.edit : undefined}
          onDelete={can('DELETE_VIDEO') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('common.title')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="videocam-outline"
            required
          />
          <TextField
            label={t('video.videoUrl')}
            value={form.videoUrl}
            onChangeText={(v) => set('videoUrl', v)}
            error={errors.videoUrl}
            hint={t('video.videoUrlHint')}
            icon="link-outline"
            autoCapitalize="none"
            required
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
          />
          <TextField
            label={t('video.speaker')}
            value={form.speaker}
            onChangeText={(v) => set('speaker', v)}
            icon="mic-outline"
          />
          <TextField
            label={t('video.thumbnail')}
            value={form.thumbnail}
            onChangeText={(v) => set('thumbnail', v)}
            hint="YouTube thumbnails are detected automatically."
            icon="image-outline"
            autoCapitalize="none"
          />
          <TextField
            label={t('video.duration')}
            value={form.duration}
            onChangeText={(v) => set('duration', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            icon="time-outline"
          />
          <DateField
            label={t('common.date')}
            value={form.date}
            onChange={(v) => set('date', v)}
          />
          <Select
            label={t('lesson.assignedClass')}
            value={form.classId}
            options={classOptions}
            onChange={(v) => set('classId', v)}
            placeholder={t('common.all')}
            allowClear
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
          {kind === 'video' ? (
            <Select<'yes' | 'no'>
              label={t('video.setFeatured')}
              value={form.isFeatured ? 'yes' : 'no'}
              options={[
                { value: 'no', label: t('common.no') },
                { value: 'yes', label: t('common.yes'), description: t('video.featuredHint') },
              ]}
              onChange={(v) => set('isFeatured', v === 'yes')}
            />
          ) : null}
        </>
      )}
    />
  );
}
