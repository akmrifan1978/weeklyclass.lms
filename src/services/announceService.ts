import i18n from '@/i18n';

import * as notifications from './notificationService';
import type { AppUser, NotificationCategory } from '@/types';

/**
 * Tells people when something is published for them.
 *
 * Every upload path — a lesson, a recording, study material, a weekly
 * assignment, an online class — ends by calling this, so "the students were
 * never told" stops being a thing that can happen through forgetfulness.
 *
 * FIRE AND FORGET, ALWAYS. A notification that fails must never undo or block
 * the publish that triggered it: the lesson is genuinely saved, and rolling that
 * back because a push token expired would be the worse outcome by a wide margin.
 * Failures are logged and swallowed.
 *
 * Nothing is sent for a draft or an unpublished record. Announcing something
 * nobody can open yet trains people to ignore the notifications that matter.
 */

export type AnnounceKind =
  | 'lesson'
  | 'video'
  | 'material'
  | 'assignment'
  | 'onlineClass'
  | 'article';

/** Category and deep link per kind, so tapping the notification lands right. */
const ROUTES: Record<AnnounceKind, { category: NotificationCategory; route: string }> = {
  lesson: { category: 'new_lesson', route: '/(student)/(tabs)/lessons' },
  video: { category: 'new_video', route: '/(student)/recordings' },
  // No category of its own for study material; it belongs with lessons, which
  // is also where someone will look for it.
  material: { category: 'new_lesson', route: '/(student)/materials' },
  assignment: { category: 'quiz_available', route: '/(student)/quizzes' },
  onlineClass: { category: 'event_reminder', route: '/(student)/online-classes' },
  article: { category: 'new_article', route: '/(student)/(tabs)' },
};

export interface AnnounceInput {
  kind: AnnounceKind;
  /** The record's own title, used verbatim in the message. */
  title: string;
  /** Restricts the audience to one class. Null means everyone. */
  classId?: string | null;
  branchId?: string | null;
  /** False for a draft — nothing is sent. */
  published?: boolean;
  /** True when this is an edit rather than a first publish. */
  isUpdate?: boolean;
  image?: string | null;
  /** Overrides the default route, e.g. to link to one specific item. */
  route?: string | null;
}

/**
 * The heading someone sees. Deliberately says which of the two happened — "new"
 * and "updated" call for different reactions, and collapsing them into one
 * message makes both less useful.
 */
function headingKey(kind: AnnounceKind, isUpdate: boolean): string {
  return `notify.${kind}${isUpdate ? 'Updated' : 'Added'}`;
}

/**
 * `translate` defaults to the app's own i18next instance rather than being
 * threaded through every service that publishes something. The heading lands in
 * whatever language the person posting is using — imperfect for a multilingual
 * audience, but the alternative is passing `t` down through six save functions
 * that have no other reason to know about translation.
 */
export async function announce(
  input: AnnounceInput,
  actor: AppUser,
  translate: (key: string, options?: Record<string, unknown>) => string = (key) =>
    i18n.t(key)
): Promise<void> {
  if (input.published === false) return;

  const { category, route } = ROUTES[input.kind];

  try {
    await notifications.send(
      {
        title: translate(headingKey(input.kind, Boolean(input.isUpdate))),
        message: input.title.trim(),
        image: input.image ?? null,
        category,
        // A class-scoped record goes to that class; anything else goes to every
        // student. Teachers get their own copy only where the record is theirs
        // to act on, which for now is nothing here — they are the ones posting.
        targetRole: input.classId ? 'class' : 'students',
        targetClassId: input.classId ?? null,
        targetBranchId: input.branchId ?? null,
        route: input.route ?? route,
      },
      actor
    );
  } catch (error) {
    console.warn(
      `[WeeklyClass] published ${input.kind} "${input.title}" but could not notify:`,
      error
    );
  }
}
