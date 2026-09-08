import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { matchesSearch } from '@/utils/format';
import { deleteClass, listBranches, listClasses, saveClass } from '@/services/orgService';
import { listUsers } from '@/services/userService';
import type { AgeBand, ClassGender, ClassRoom, LanguageCode } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { Select, TextField, type Option } from '@/components/ui';
import { TeacherPicker } from './TeacherPicker';

interface ClassForm {
  name: string;
  code: string;
  description: string;
  ageBand: AgeBand | '';
  gender: ClassGender;
  branchId: string;
  /** Every teacher who may act on this group, not just the first. */
  teacherIds: string[];
  schedule: string;
  language: LanguageCode;
  status: 'active' | 'inactive';
}

const EMPTY: ClassForm = {
  name: '',
  code: '',
  description: '',
  ageBand: '',
  // Not defaulted to male or female. A group is separated on purpose or it is
  // not, and guessing puts students in the wrong room.
  gender: 'mixed',
  branchId: '',
  teacherIds: [],
  schedule: '',
  language: 'en',
  status: 'active',
};

export function ClassManager() {
  const { t } = useTranslation();
  const { user, can } = useAuth();

  const loadRefs = useCallback(async () => {
    const [branches, teachers] = await Promise.all([
      // Reported, not swallowed. A query that fails — a missing composite index
      // is the usual cause, and it fails with a link to create it — produced an
      // empty picker reading "No results found", which is indistinguishable
      // from genuinely having no branches and sends you looking in the wrong
      // place entirely.
      listBranches().catch((error) => {
        console.error('[WeeklyClass] could not list branches for the class form:', error);
        return [];
      }),
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
        ageBand: klass.ageBand ?? '',
        gender: klass.gender ?? 'mixed',
        teacherIds: klass.teacherIds ?? [],
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
            ageBand: form.ageBand || undefined,
            gender: form.gender,
            // The first selected teacher stays the primary one, because a
            // single name is what a card and a notification can show. The full
            // list is what the security rules read.
            teacherId: form.teacherIds[0] ?? null,
            teacherIds: form.teacherIds,
            // Written here rather than looked up later: the registration
            // screen is signed out and cannot read the users collection.
            teacherNames: form.teacherIds
              .map((id) => (refs?.teachers ?? []).find((teacher) => teacher.uid === id)?.fullName)
              .filter((name): name is string => Boolean(name)),
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
          {/* This is the id a student is given and types at registration, so
              it is labelled as that rather than as "Title" — which is what it
              said, and which explained nothing to whoever had to fill it in. */}
          <TextField
            label={t('auth.classId')}
            value={form.code}
            onChangeText={(v) => set('code', v.toUpperCase())}
            hint={t('auth.classIdHint')}
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
          <Select<AgeBand>
            label={t('classGroup.ageBand')}
            value={form.ageBand || null}
            options={[
              { value: 'children', label: t('classGroup.age_children') },
              { value: 'teenagers', label: t('classGroup.age_teenagers') },
              { value: 'adults', label: t('classGroup.age_adults') },
            ]}
            onChange={(v) => set('ageBand', v)}
            allowClear
          />

          <Select<ClassGender>
            label={t('classGroup.gender')}
            value={form.gender}
            options={[
              { value: 'male', label: t('classGroup.gender_male') },
              { value: 'female', label: t('classGroup.gender_female') },
              {
                value: 'mixed',
                label: t('classGroup.gender_mixed'),
                description: t('classGroup.genderMixedHint'),
              },
            ]}
            onChange={(v) => set('gender', v)}
          />

          {/* Several teachers, not one. The rules already read the whole list;
              until now the editor could only ever write a single name into it,
              so a group taught by two people could not be described. */}
          <TeacherPicker
            label={t('classGroup.teachers')}
            hint={t('classGroup.teachersHint')}
            teachers={refs?.teachers ?? []}
            selected={form.teacherIds}
            onChange={(next) => set('teacherIds', next)}
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
