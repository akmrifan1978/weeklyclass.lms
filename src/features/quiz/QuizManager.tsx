import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import { formatDuration } from '@/utils/date';
import {
  deleteQuiz,
  duplicateQuiz,
  listQuizzes,
  saveQuiz,
  setQuizStatus,
} from '@/services/quizService';
import { listClasses, studentCounts } from '@/services/orgService';
import type { LanguageCode, Quiz, QuizStatus } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { IconButton, Select, TextField, type Option } from '@/components/ui';

interface QuizForm {
  title: string;
  description: string;
  classId: string;
  timeLimit: string;
  passMark: string;
  maxAttempts: string;
  language: LanguageCode;
  status: QuizStatus;
}

const EMPTY: QuizForm = {
  title: '',
  description: '',
  classId: '',
  timeLimit: '0',
  passMark: '50',
  maxAttempts: '1',
  language: 'en',
  status: 'draft',
};

/**
 * Quiz list. Questions live on their own screen because they are a subcollection
 * with a separately-secured answer key — see `QuizEditor`.
 */
export function QuizManager({ classScope }: { classScope?: string[] }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const loadClasses = useCallback(async () => {
    const page = await listClasses({ pageSize: 100 });
    return classScope ? page.items.filter((c) => classScope.includes(c.id)) : page.items;
  }, [classScope]);

  const { data: classes } = useAsync(loadClasses, [classScope?.join(',')]);

  const classIds = (classes ?? []).map((c) => c.id).join(',');

  /**
   * Every group in the picker, with the number of students in it.
   *
   * The one mistake this screen makes is easy to make and invisible afterwards:
   * an assignment given to a group with nobody in it. Registration puts
   * students into the gendered groups, so a plain "Adults" group left over from
   * before holds nobody — and choosing it publishes an assignment no student
   * can open. The count turns that into something a person can see before they
   * choose.
   */
  const loadCounts = useCallback(
    (): Promise<Record<string, number>> =>
      classIds ? studentCounts(classIds.split(',')) : Promise.resolve({}),
    [classIds]
  );
  const { data: counts } = useAsync(loadCounts, [classIds]);

  const classOptions = useMemo<Option[]>(
    () =>
      (classes ?? []).map((c) => {
        const students = counts?.[c.id];
        if (students === undefined) return { value: c.id, label: c.name };
        return {
          value: c.id,
          label:
            students > 0
              ? t('quiz.classWithStudents', { name: c.name, count: students })
              : t('quiz.classNoStudents', { name: c.name }),
        };
      }),
    [classes, counts, t]
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
      const page = await listQuizzes({ cursor, pageSize: 20 });
      const scoped = classScope
        ? page.items.filter((quiz) => classScope.includes(quiz.classId))
        : page.items;
      return {
        ...page,
        items: search
          ? scoped.filter((quiz) => matchesSearch(search, quiz.title, quiz.description))
          : scoped,
      };
    },
    [classScope]
  );

  /*
   * Publishing used to be refused here whenever `quiz.questionCount` was zero.
   * That field is written by the question editor and was being reset to zero by
   * every edit of the assignment's details, so a ready ten-question assignment
   * could not be published and the reason given on screen — "Add at least one
   * question" — was untrue. The check now lives in the service, where it counts
   * the questions themselves; this reports what happened, including how many
   * students the assignment actually reached.
   */
  const cycleStatus = async (quiz: Quiz, reload: () => void) => {
    if (!user) return;
    const next: QuizStatus =
      quiz.status === 'draft' ? 'published' : quiz.status === 'published' ? 'closed' : 'published';
    try {
      const { students } = await setQuizStatus(quiz.id, next, user);
      if (next !== 'published' || students === null) toast.success(t('common.success'));
      else if (students === 0) toast.error(t('quiz.publishedNoStudents'));
      else toast.success(t('quiz.publishedTo', { count: students }));
      reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    }
  };

  /** A second copy of the week's assignment, for the other class group. */
  const copyQuiz = async (quiz: Quiz, reload: () => void) => {
    if (!user) return;
    try {
      await duplicateQuiz(quiz.id, user, `${quiz.title} (${t('common.copy')})`);
      toast.success(t('quiz.copied'));
      reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    }
  };

  return (
    <CrudScreen<Quiz, QuizForm>
      title={t('quiz.title')}
      addLabel={t('quiz.createQuiz')}
      emptyIcon="help-circle-outline"
      emptyTitle={t('quiz.noQuizzes')}
      canCreate={can('CREATE_QUIZ')}
      canDelete={can('DELETE_QUIZ')}
      deps={[classScope?.join(',')]}
      fetchPage={fetchPage}
      emptyForm={EMPTY}
      toForm={(quiz) => ({
        title: quiz.title,
        description: quiz.description ?? '',
        classId: quiz.classId,
        timeLimit: String(quiz.timeLimit ?? 0),
        passMark: String(quiz.passMark ?? 50),
        maxAttempts: String(quiz.maxAttempts ?? 1),
        language: quiz.language,
        status: quiz.status,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.classId) errors.classId = 'validation.selectClass';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        const id = await saveQuiz(
          {
            title: form.title.trim(),
            description: form.description.trim(),
            classId: form.classId,
            branchId: form.classId
              ? (branchForClass.get(form.classId) ?? null)
              : null,
            timeLimit: Number(form.timeLimit) || 0,
            passMark: Number(form.passMark) || 50,
            maxAttempts: Number(form.maxAttempts) || 0,
            language: form.language,
            status: form.status,
          },
          user,
          existing?.id
        );
        /*
         * A brand-new assignment has no questions yet, so go straight to the
         * editor - the one in the area this person is allowed in.
         *
         * This always sent everybody to /(admin)/..., which the role gate turns
         * a teacher straight out of. Creating an assignment therefore dropped a
         * teacher back on their dashboard, with a draft they could not add a
         * single question to - and an assignment with no questions cannot be
         * published. From where they stood, assignments simply did not work.
         */
        if (!existing) {
          setTimeout(() => {
            if (user.role === 'teacher') router.push(`/(teacher)/quiz/${id}`);
            else router.push(`/(admin)/quiz/${id}`);
          }, 300);
        }
        return id;
      }}
      onDelete={async (quiz) => {
        if (!user) return;
        await deleteQuiz(quiz.id, user);
      }}
      renderItem={(quiz, actions) => (
        <AdminRow
          icon="help-circle-outline"
          iconTint={quiz.status === 'published' ? colors.success : colors.primary}
          title={quiz.title}
          subtitle={quiz.description || undefined}
          meta={[
            classNameFor(quiz.classId),
            `${quiz.questionCount} ${t('quiz.questions')}`,
            `${quiz.totalMarks} ${t('quiz.marks')}`,
            quiz.timeLimit ? formatDuration(quiz.timeLimit) : t('quiz.noTimeLimit'),
          ].join(' · ')}
          badges={[{ label: t(`common.${quiz.status === 'closed' ? 'archived' : quiz.status}`), tone: quiz.status }]}
          onPress={() =>
            user?.role === 'teacher'
              ? router.push(`/(teacher)/quiz/${quiz.id}`)
              : router.push(`/(admin)/quiz/${quiz.id}`)
          }
          extraActions={
            <>
              {can('CREATE_QUIZ') ? (
                <IconButton
                  icon="copy-outline"
                  label={t('quiz.copyQuiz')}
                  size={36}
                  onPress={() => copyQuiz(quiz, actions.reload)}
                />
              ) : null}
              {can('EDIT_QUIZ') ? (
                <IconButton
                  icon={quiz.status === 'published' ? 'lock-closed-outline' : 'send-outline'}
                  label={t(quiz.status === 'published' ? 'quiz.closeQuiz' : 'quiz.publish')}
                  size={36}
                  color={quiz.status === 'published' ? colors.warning : colors.success}
                  background={quiz.status === 'published' ? colors.warningSoft : colors.successSoft}
                  onPress={() => cycleStatus(quiz, actions.reload)}
                />
              ) : null}
            </>
          }
          onEdit={can('EDIT_QUIZ') ? actions.edit : undefined}
          onDelete={can('DELETE_QUIZ') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('common.title')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="help-circle-outline"
            required
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
          />
          <Select
            label={t('auth.class')}
            value={form.classId}
            options={classOptions}
            onChange={(v) => set('classId', v)}
            error={errors.classId}
            required
          />
          <TextField
            label={t('quiz.timeLimit')}
            value={form.timeLimit}
            onChangeText={(v) => set('timeLimit', v.replace(/[^0-9]/g, ''))}
            hint={t('quiz.noTimeLimit')}
            keyboardType="number-pad"
            icon="time-outline"
          />
          <TextField
            label={t('quiz.passMark')}
            value={form.passMark}
            onChangeText={(v) => set('passMark', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            icon="ribbon-outline"
          />
          <TextField
            label={t('quiz.maxAttempts')}
            value={form.maxAttempts}
            onChangeText={(v) => set('maxAttempts', v.replace(/[^0-9]/g, ''))}
            hint={t('quiz.unlimitedAttempts')}
            keyboardType="number-pad"
            icon="repeat-outline"
          />
          <Select<QuizStatus>
            label={t('common.status')}
            value={form.status}
            options={[
              { value: 'draft', label: t('common.draft') },
              { value: 'published', label: t('common.published') },
              { value: 'closed', label: t('quiz.closed') },
            ]}
            onChange={(v) => set('status', v)}
          />
        </>
      )}
    />
  );
}
