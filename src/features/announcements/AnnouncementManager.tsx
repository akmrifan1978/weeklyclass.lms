import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { colors } from '@/constants/theme';
import { formatShortDate } from '@/utils/date';
import { matchesSearch, truncate } from '@/utils/format';
import {
  deleteAnnouncement,
  listAnnouncements,
  saveAnnouncement,
} from '@/services/notificationService';
import { listBranches, listClasses } from '@/services/orgService';
import type { Announcement, ContentStatus, NotificationTarget, Priority } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { ImageField } from '@/components/shared/ImageField';
import { DateField, Select, TextField, ToggleRow, type Option } from '@/components/ui';

interface AnnouncementForm {
  title: string;
  message: string;
  image: string;
  targetRole: NotificationTarget;
  targetClassId: string;
  targetBranchId: string;
  priority: Priority;
  popup: boolean;
  expiresAt: string;
  status: ContentStatus;
}

const EMPTY: AnnouncementForm = {
  title: '',
  message: '',
  image: '',
  targetRole: 'all',
  targetClassId: '',
  targetBranchId: '',
  priority: 'normal',
  popup: false,
  expiresAt: '',
  status: 'published',
};

const PRIORITY_TONE: Record<Priority, string> = {
  urgent: 'suspended',
  high: 'pending',
  normal: 'active',
  low: 'inactive',
};

export function AnnouncementManager() {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const loadRefs = useCallback(async () => {
    const [branches, classPage] = await Promise.all([
      listBranches().catch(() => []),
      listClasses({ pageSize: 100 }).catch(() => ({ items: [], cursor: null, hasMore: false })),
    ]);
    return { branches, classes: classPage.items };
  }, []);

  const { data: refs } = useAsync(loadRefs, []);

  const branchOptions = useMemo<Option[]>(
    () => (refs?.branches ?? []).map((b) => ({ value: b.id, label: b.name })),
    [refs?.branches]
  );
  const classOptions = useMemo<Option[]>(
    () => (refs?.classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [refs?.classes]
  );

  const fetchPage = useCallback(async (_cursor: Cursor, search: string) => {
    const items = await listAnnouncements({ pageSize: 50 });
    return {
      items: search ? items.filter((a) => matchesSearch(search, a.title, a.message)) : items,
      cursor: null,
      hasMore: false,
    };
  }, []);

  return (
    <CrudScreen<Announcement, AnnouncementForm>
      title={t('announcement.title')}
      addLabel={t('announcement.create')}
      emptyIcon="megaphone-outline"
      emptyTitle={t('announcement.noAnnouncements')}
      canCreate={can('MANAGE_ANNOUNCEMENTS')}
      canDelete={can('MANAGE_ANNOUNCEMENTS')}
      fetchPage={fetchPage}
      emptyForm={EMPTY}
      toForm={(announcement) => ({
        title: announcement.title,
        message: announcement.message,
        image: announcement.image ?? '',
        targetRole: announcement.targetRole,
        targetClassId: announcement.targetClassId ?? '',
        targetBranchId: announcement.targetBranchId ?? '',
        priority: announcement.priority,
        popup: announcement.popup === true,
        expiresAt: '',
        status: announcement.status,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.message.trim()) errors.message = 'validation.fieldRequired';
        if (form.targetRole === 'class' && !form.targetClassId)
          errors.targetClassId = 'validation.selectClass';
        if (form.targetRole === 'branch' && !form.targetBranchId)
          errors.targetBranchId = 'validation.fieldRequired';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveAnnouncement(
          {
            title: form.title.trim(),
            message: form.message.trim(),
            image: form.image.trim() || null,
            targetRole: form.targetRole,
            targetClassId: form.targetRole === 'class' ? form.targetClassId : null,
            targetBranchId: form.targetRole === 'branch' ? form.targetBranchId : null,
            priority: form.priority,
            popup: form.popup,
            status: form.status,
            expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (announcement) => {
        if (!user) return;
        await deleteAnnouncement(announcement.id, user);
      }}
      renderItem={(announcement, actions) => (
        <AdminRow
          icon="megaphone-outline"
          iconTint={
            announcement.priority === 'urgent' || announcement.priority === 'high'
              ? colors.danger
              : colors.primary
          }
          title={announcement.title}
          subtitle={truncate(announcement.message, 110)}
          meta={formatShortDate(announcement.publishedAt ?? announcement.createdAt)}
          badges={[
            {
              label: t(
                `announcement.priority${announcement.priority.charAt(0).toUpperCase()}${announcement.priority.slice(1)}`
              ),
              tone: PRIORITY_TONE[announcement.priority],
            },
            { label: t(`common.${announcement.status}`), tone: announcement.status },
          ]}
          onEdit={can('MANAGE_ANNOUNCEMENTS') ? actions.edit : undefined}
          onDelete={can('MANAGE_ANNOUNCEMENTS') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('common.title')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="megaphone-outline"
            required
          />
          <TextField
            label={t('notification.message')}
            value={form.message}
            onChangeText={(v) => set('message', v)}
            error={errors.message}
            multiline
            required
          />
          {/* The full field, not a bare link box.
              This asked for a URL and offered no way to produce one, so
              anybody holding an actual picture — which is everybody — had
              nowhere to put it. ImageField gives an upload button, a preview
              and the paste-a-link box, and it was already used everywhere
              else images are set. */}
          <ImageField
            label={t('article.coverImage')}
            value={form.image}
            onChange={(url) => set('image', url)}
            kind="article"
            // Wide, because a cover is shown as a banner rather than a square.
            aspectRatio={16 / 9}
          />
          <Select<NotificationTarget>
            label={t('notification.sendTo')}
            value={form.targetRole}
            options={[
              { value: 'all', label: t('notification.targetAll') },
              { value: 'students', label: t('notification.targetStudents') },
              { value: 'teachers', label: t('notification.targetTeachers') },
              { value: 'class', label: t('notification.targetClass') },
              { value: 'branch', label: t('notification.targetBranch') },
            ]}
            onChange={(v) => set('targetRole', v)}
          />
          {form.targetRole === 'class' ? (
            <Select
              label={t('auth.class')}
              value={form.targetClassId}
              options={classOptions}
              onChange={(v) => set('targetClassId', v)}
              error={errors.targetClassId}
              required
            />
          ) : null}
          {form.targetRole === 'branch' ? (
            <Select
              label={t('auth.branch')}
              value={form.targetBranchId}
              options={branchOptions}
              onChange={(v) => set('targetBranchId', v)}
              error={errors.targetBranchId}
              required
            />
          ) : null}
          <Select<Priority>
            label={t('announcement.priority')}
            value={form.priority}
            options={[
              { value: 'low', label: t('announcement.priorityLow') },
              { value: 'normal', label: t('announcement.priorityNormal') },
              { value: 'high', label: t('announcement.priorityHigh') },
              { value: 'urgent', label: t('announcement.priorityUrgent') },
            ]}
            onChange={(v) => set('priority', v)}
          />

          {/* Off unless somebody chooses it. A popup interrupts every student
              on every device, and it stops working the moment it is routine. */}
          <ToggleRow
            label={t('announcement.showAsPopup')}
            description={t('announcement.showAsPopupHint')}
            value={form.popup}
            onValueChange={(v: boolean) => set('popup', v)}
          />
          <DateField
            label={t('announcement.expiresAt')}
            value={form.expiresAt}
            onChange={(v) => set('expiresAt', v)}
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
