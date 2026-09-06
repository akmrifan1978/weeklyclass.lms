import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { matchesSearch } from '@/utils/format';
import { formatShortDate } from '@/utils/date';
import { deleteLesson, listLessons, saveLesson } from '@/services/contentService';
import { listClasses } from '@/services/orgService';
import type { ClassRoom, ContentStatus, LanguageCode, Lesson } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { DateField, Select, TextField, type Option } from '@/components/ui';

interface LessonForm {
  title: string;
  description: string;
  weekNumber: string;
  subject: string;
  classId: string;
  videoUrl: string;
  audioUrl: string;
  pdfUrl: string;
  duration: string;
  language: LanguageCode;
  publishDate: string;
  status: ContentStatus;
}

const EMPTY: LessonForm = {
  title: '',
  description: '',
  weekNumber: '1',
  subject: '',
  classId: '',
  videoUrl: '',
  audioUrl: '',
  pdfUrl: '',
  duration: '',
  language: 'en',
  publishDate: '',
  status: 'published',
};

/**
 * Lesson management for admins and permitted teachers.
 *
 * `classScope` restricts the list to a teacher's own classes — the same
 * restriction the security rules apply, so the UI never offers something the
 * database will refuse.
 */
export function LessonManager({ classScope }: { classScope?: string[] }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const loadClasses = useCallback(async () => {
    const page = await listClasses({ pageSize: 100 });
    return classScope ? page.items.filter((c) => classScope.includes(c.id)) : page.items;
  }, [classScope]);

  const { data: classes } = useAsync(loadClasses, [classScope?.join(',')]);

  const classOptions = useMemo<Option[]>(
    () => (classes ?? []).map((c: ClassRoom) => ({ value: c.id, label: c.name })),
    [classes]
  );

  /**
   * The branch a class belongs to, so the record can carry it without anyone
   * being asked for it twice. Two fields that must agree are two fields that
   * will eventually disagree.
   */
  const branchForClass = useMemo(
    () => new Map((classes ?? []).map((c) => [c.id, c.branchId ?? null])),
    [classes]
  );
  const classNameFor = useCallback(
    (id: string) => (classes ?? []).find((c) => c.id === id)?.name ?? id,
    [classes]
  );

  const fetchPage = useCallback(
    async (cursor: Cursor, search: string) => {
      const page = await listLessons({ cursor, pageSize: 20 });
      const scoped = classScope
        ? page.items.filter((lesson) => classScope.includes(lesson.classId))
        : page.items;
      // Firestore has no full-text search; the page is already small, so
      // narrowing it locally keeps the query cost at one read per document.
      return {
        ...page,
        items: search
          ? scoped.filter((lesson) => matchesSearch(search, lesson.title, lesson.description, lesson.subject))
          : scoped,
      };
    },
    [classScope]
  );

  return (
    <CrudScreen<Lesson, LessonForm>
      title={t('lesson.title')}
      addLabel={t('dashboard.addLesson')}
      emptyIcon="book-outline"
      emptyTitle={t('lesson.noLessons')}
      canCreate={can('CREATE_LESSONS')}
      canDelete={can('DELETE_LESSONS')}
      deps={[classScope?.join(',')]}
      fetchPage={fetchPage}
      emptyForm={EMPTY}
      toForm={(lesson) => ({
        title: lesson.title,
        description: lesson.description ?? '',
        weekNumber: String(lesson.weekNumber ?? 1),
        subject: lesson.subject ?? '',
        classId: lesson.classId,
        videoUrl: lesson.videoUrl ?? '',
        audioUrl: lesson.audioUrl ?? '',
        pdfUrl: lesson.pdfUrl ?? '',
        duration: lesson.duration ? String(lesson.duration) : '',
        language: lesson.language,
        publishDate: '',
        status: lesson.status,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.classId) errors.classId = 'validation.selectClass';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveLesson(
          {
            title: form.title.trim(),
            description: form.description.trim(),
            weekNumber: Number(form.weekNumber) || 1,
            subject: form.subject.trim() || undefined,
            classId: form.classId,
            branchId: form.classId
              ? (branchForClass.get(form.classId) ?? null)
              : null,
            teacherId: user.role === 'teacher' ? user.uid : (existing?.teacherId ?? null),
            videoUrl: form.videoUrl.trim() || null,
            audioUrl: form.audioUrl.trim() || null,
            pdfUrl: form.pdfUrl.trim() || null,
            duration: form.duration ? Number(form.duration) : undefined,
            language: form.language,
            status: form.status,
            publishDate: form.publishDate ? new Date(form.publishDate) : new Date(),
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (lesson) => {
        if (!user) return;
        await deleteLesson(lesson.id, user);
      }}
      renderItem={(lesson, actions) => (
        <AdminRow
          icon="book-outline"
          title={lesson.title}
          subtitle={lesson.description || undefined}
          meta={`${t('lesson.week', { number: lesson.weekNumber })} · ${classNameFor(lesson.classId)} · ${formatShortDate(lesson.publishDate ?? lesson.createdAt)}`}
          badges={[
            { label: t(`common.${lesson.status}`), tone: lesson.status },
            ...(lesson.videoUrl ? [{ label: 'Video' }] : []),
            ...(lesson.pdfUrl ? [{ label: 'PDF' }] : []),
          ]}
          onEdit={can('EDIT_LESSONS') ? actions.edit : undefined}
          onDelete={can('DELETE_LESSONS') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('common.title')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="book-outline"
            required
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
          />
          <Select
            label={t('lesson.assignedClass')}
            value={form.classId}
            options={classOptions}
            onChange={(v) => set('classId', v)}
            error={errors.classId}
            required
          />
          <TextField
            label={t('lesson.weekNumber')}
            value={form.weekNumber}
            onChangeText={(v) => set('weekNumber', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            icon="calendar-number-outline"
          />
          <TextField
            label={t('lesson.subject')}
            value={form.subject}
            onChangeText={(v) => set('subject', v)}
            icon="bookmark-outline"
          />
          <TextField
            label={t('video.videoUrl')}
            value={form.videoUrl}
            onChangeText={(v) => set('videoUrl', v)}
            hint={t('video.videoUrlHint')}
            icon="videocam-outline"
            autoCapitalize="none"
          />
          <TextField
            label={t('lesson.audio')}
            value={form.audioUrl}
            onChangeText={(v) => set('audioUrl', v)}
            icon="headset-outline"
            autoCapitalize="none"
          />
          <TextField
            label={t('lesson.pdf')}
            value={form.pdfUrl}
            onChangeText={(v) => set('pdfUrl', v)}
            icon="document-text-outline"
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
            label={t('lesson.publishDate')}
            value={form.publishDate}
            onChange={(v) => set('publishDate', v)}
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
        </>
      )}
    />
  );
}
