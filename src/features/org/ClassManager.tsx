import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { matchesSearch } from '@/utils/format';
import { deleteClass, listBranches, listClasses, saveClass } from '@/services/orgService';
import { listUsers } from '@/services/userService';
import type { ClassRoom, LanguageCode } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { Select, TextField, type Option } from '@/components/ui';

interface ClassForm {
  name: string;
  code: string;
  description: string;
  branchId: string;
  teacherId: string;
  schedule: string;
  language: LanguageCode;
  status: 'active' | 'inactive';
}

const EMPTY: ClassForm = {
  name: '',
  code: '',
  description: '',
  branchId: '',
  teacherId: '',
  schedule: '',
  language: 'en',
  status: 'active',
};

export function ClassManager() {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const loadRefs = useCallback(async () => {
    const [branches, teachers] = await Promise.all([
      listBranches().catch(() => []),
      listUsers({ role: 'teacher', status: 'active', pageSize: 100 })
        .then((p) => p.items)
        .catch(() => []),
    ]);
    return { branches, teachers };
  }, []);

  const { data: refs } = useAsync(loadRefs, []);

  const branchOptions = useMemo<Option[]>(
    () => (refs?.branches ?? []).map((b) => ({ value: b.id, label: b.name, description: b.city })),
    [refs?.branches]
  );
  const teacherOptions = useMemo<Option[]>(
    () =>
      (refs?.teachers ?? []).map((teacher) => ({
        value: teacher.uid,
        label: teacher.fullName,
        description: teacher.teacherId,
      })),
    [refs?.teachers]
  );
  const branchName = useCallback(
    (id: string) => (refs?.branches ?? []).find((b) => b.id === id)?.name ?? '',
    [refs?.branches]
  );
  const teacherName = useCallback(
    (id?: string | null) =>
      id ? ((refs?.teachers ?? []).find((teacher) => teacher.uid === id)?.fullName ?? '') : '',
    [refs?.teachers]
  );

  const fetchPage = useCallback(async (cursor: Cursor, search: string) => {
    const page = await listClasses({ cursor, pageSize: 30 });
    return {
      ...page,
      items: search
        ? page.items.filter((c) => matchesSearch(search, c.name, c.code, c.description))
        : page.items,
    };
  }, []);

  return (
    <CrudScreen<ClassRoom, ClassForm>
      title={t('nav.classes')}
      addLabel={t('admin.createClass')}
      emptyIcon="library-outline"
      emptyTitle={t('empty.nothingHere')}
      canCreate={can('CREATE_CLASSES')}
      canDelete={can('DELETE_CLASSES')}
      fetchPage={fetchPage}
      emptyForm={EMPTY}
      toForm={(klass) => ({
        name: klass.name,
        code: klass.code ?? '',
        description: klass.description ?? '',
        branchId: klass.branchId,
        teacherId: klass.teacherId ?? '',
        schedule: klass.schedule ?? '',
        language: klass.language,
        status: klass.status,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.name.trim()) errors.name = 'validation.fieldRequired';
        if (!form.branchId) errors.branchId = 'validation.fieldRequired';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveClass(
          {
            name: form.name.trim(),
            code: form.code.trim(),
            description: form.description.trim(),
            branchId: form.branchId,
            teacherId: form.teacherId || null,
            // `teacherIds` is what class-scoped security rules read, so the
            // primary teacher is always merged into it by the service.
            teacherIds: existing?.teacherIds ?? [],
            schedule: form.schedule.trim(),
            language: form.language,
            status: form.status,
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (klass) => {
        if (!user) return;
        await deleteClass(klass.id, user);
      }}
      renderItem={(klass, actions) => (
        <AdminRow
          icon="library-outline"
          title={klass.name}
          subtitle={klass.description || undefined}
          meta={[branchName(klass.branchId), teacherName(klass.teacherId), klass.schedule]
            .filter(Boolean)
            .join(' · ')}
          badges={[
            { label: t(`common.${klass.status}`), tone: klass.status },
            ...(klass.code ? [{ label: klass.code }] : []),
          ]}
          onEdit={can('EDIT_CLASSES') ? actions.edit : undefined}
          onDelete={can('DELETE_CLASSES') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('auth.class')}
            value={form.name}
            onChangeText={(v) => set('name', v)}
            error={errors.name}
            icon="library-outline"
            required
          />
          <TextField
            label={t('common.title')}
            value={form.code}
            onChangeText={(v) => set('code', v.toUpperCase())}
            hint="Short code, e.g. WK-A1"
            autoCapitalize="characters"
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
          />
          <Select
            label={t('auth.branch')}
            value={form.branchId}
            options={branchOptions}
            onChange={(v) => set('branchId', v)}
            error={errors.branchId}
            required
          />
          <Select
            label={t('admin.primaryTeacher')}
            value={form.teacherId}
            options={teacherOptions}
            onChange={(v) => set('teacherId', v)}
            searchable
            allowClear
          />
          <TextField
            label={t('common.time')}
            value={form.schedule}
            onChangeText={(v) => set('schedule', v)}
            hint="e.g. Fridays 9:00 PM"
            icon="time-outline"
          />
          <Select<'active' | 'inactive'>
            label={t('common.status')}
            value={form.status}
            options={[
              { value: 'active', label: t('common.active') },
              { value: 'inactive', label: t('common.inactive') },
            ]}
            onChange={(v) => set('status', v)}
          />
        </>
      )}
    />
  );
}
