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
import { getSettings } from '@/services/settingsService';
import type { ContentStatus, LanguageCode, VideoItem, VideoKind } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { PublishActions } from '@/features/PublishActions';
import { AdminRow } from '@/features/AdminRow';
import { DateField, IconButton, Select, TextField, type Option } from '@/components/ui';
import { ImageField } from '@/components/shared/ImageField';

interface VideoForm {
  title: string;
  description: string;
  speaker: string;
  venue: string;
  videoUrl: string;
  thumbnail: string;
  logoUrl: string;
  bannerUrl: string;
  duration: string;
  date: string;
  classId: string;
  language: LanguageCode;
  status: ContentStatus;
  isFeatured: boolean;
  isLive: boolean;
}

const EMPTY: VideoForm = {
  title: '',
  description: '',
  speaker: '',
  venue: '',
  videoUrl: '',
  thumbnail: '',
  logoUrl: '',
  bannerUrl: '',
  duration: '',
  date: '',
  classId: '',
  language: 'en',
  // New work starts as a DRAFT. Something half-written reaching a class
  // before its author meant it to is not recoverable by editing it
  // afterwards — they have already read it.
  status: 'draft',
  isFeatured: false,
  isLive: false,
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

  // New recordings start from the organisation's current branding so it does not
  // have to be re-entered each time. It is then COPIED onto the record, so
  // changing these defaults later never alters anything already published.
  const loadBrandingDefaults = useCallback(async () => {
    const settings = await getSettings().catch(() => null);
    return {
      logoUrl: settings?.logoUrl ?? '',
      bannerUrl: settings?.bannerUrl ?? '',
      thumbnail: settings?.thumbnailUrl ?? '',
    };
  }, []);

  const { data: branding } = useAsync(loadBrandingDefaults, []);

  const classOptions = useMemo<Option[]>(
    () => (classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  /**
   * The branch a class belongs to.
   *
   * A recording assigned to a class is, by definition, for that class's branch,
   * so the branch is read from the class rather than asked for a second time.
   * Two fields that must agree are two fields that will eventually disagree.
   */
  const branchForClass = useMemo(
    () => new Map((classes ?? []).map((c) => [c.id, c.branchId ?? null])),
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
          ? scoped.filter((v) => matchesSearch(search, v.title, v.speaker, v.venue, v.description))
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
      emptyForm={{
        ...EMPTY,
        logoUrl: branding?.logoUrl ?? '',
        bannerUrl: branding?.bannerUrl ?? '',
        thumbnail: branding?.thumbnail ?? '',
      }}
      toForm={(video) => ({
        title: video.title,
        description: video.description ?? '',
        speaker: video.speaker ?? '',
        venue: video.venue ?? '',
        videoUrl: video.videoUrl,
        thumbnail: video.thumbnail ?? '',
        logoUrl: video.logoUrl ?? '',
        bannerUrl: video.bannerUrl ?? '',
        duration: video.duration ? String(video.duration) : '',
        date: '',
        classId: video.classId ?? '',
        language: video.language,
        status: video.status,
        isFeatured: video.isFeatured,
        isLive: video.isLive ?? false,
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
            venue: form.venue.trim(),
            videoUrl: form.videoUrl.trim(),
            thumbnail: form.thumbnail.trim() || null,
            // Copied onto the record, not referenced. Editing the defaults later
            // must not restyle recordings that are already published.
            logoUrl: form.logoUrl.trim() || null,
            bannerUrl: form.bannerUrl.trim() || null,
            duration: form.duration ? Number(form.duration) : undefined,
            date: form.date ? new Date(form.date) : new Date(),
            classId: form.classId || null,
            // Denormalised from the class so `listVideos({ branchId })` — which
            // has always accepted the filter — finally has something to filter
            // on. A recording with no class stays branch-less, which is what
            // makes it visible to everyone.
            branchId: form.classId ? (branchForClass.get(form.classId) ?? null) : null,
            language: form.language,
            status: form.status,
            isFeatured: form.isFeatured,
            isLive: form.isLive,
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
          meta={[video.venue, formatShortDate(video.date ?? video.createdAt)]
            .filter(Boolean)
            .join(' · ')}
          badges={[
            ...(video.isLive ? [{ label: t('video.live'), tone: 'suspended' }] : []),
            { label: t(`common.${video.status}`), tone: video.status },
            ...(video.isFeatured ? [{ label: t('video.featured'), tone: 'active' }] : []),
          ]}
          extraActions={
            <PublishActions
              status={video.status}
              previewUrl={video.videoUrl}
              canEdit={can('UPLOAD_VIDEO')}
              onSetStatus={async (next) => {
                if (!user) return;
                await saveVideo({ ...video, status: next }, user, video.id);
                actions.reload();
              }}
              extra={
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
            />
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
            label={t('video.venue')}
            value={form.venue}
            onChangeText={(v) => set('venue', v)}
            hint={t('video.venueHint')}
            icon="location-outline"
          />
          {/* Was a link box sitting between two proper image fields, which
              made it the one picture on this form nobody could upload. */}
          <ImageField
            label={t('video.thumbnail')}
            value={form.thumbnail}
            onChange={(url) => set('thumbnail', url)}
            hint={t('video.thumbnailAuto')}
            kind="thumbnail"
            aspectRatio={16 / 9}
          />

          <ImageField
            label={t('video.logo')}
            value={form.logoUrl}
            onChange={(url) => set('logoUrl', url)}
            hint={t('video.brandingHint')}
            aspectRatio={1}
          />

          <ImageField
            label={t('video.banner')}
            value={form.bannerUrl}
            onChange={(url) => set('bannerUrl', url)}
            aspectRatio={3}
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
          <Select<'yes' | 'no'>
            label={t('video.markAsLive')}
            value={form.isLive ? 'yes' : 'no'}
            options={[
              { value: 'no', label: t('common.no') },
              { value: 'yes', label: t('common.yes'), description: t('video.liveHint') },
            ]}
            onChange={(v) => set('isLive', v === 'yes')}
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
