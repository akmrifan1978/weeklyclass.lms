import { doc, deleteDoc, setDoc } from 'firebase/firestore';

import { COLLECTIONS } from '@/constants/app';
import { db } from '@/firebase/config';
import { getById, listAll } from './firestore';
import type { AppUser, ClassRoom, Lesson, PublicLesson, PublicTeacher } from '@/types';

/**
 * The public website's own copies of things.
 *
 * Everything here follows the rule the public schedule already set: a page that
 * a signed-out stranger can read never queries the real collection. It reads a
 * thin mirror holding exactly the fields somebody outside is meant to see, and
 * nothing else is even in the document.
 *
 * That is not the same as a security rule that hides fields, because Firestore
 * has no such rule — a rule grants or denies a whole document. Writing a
 * separate document is the only way to publish a lesson's title without also
 * publishing its notes, or a teacher's name without also publishing the mobile
 * number they sign in with.
 *
 * Both mirrors are written by an admin as a side effect of saving the real
 * record, and both are best effort: a mirror that could not be updated is an
 * out-of-date advertisement, and failing the save over one would lose the
 * lesson to protect the poster.
 */

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

/**
 * A teacher's public profile, if they have one.
 *
 * Opt-in, per person, and off unless an admin has switched it on. Publishing
 * staff by default would put a list of real people's names on the open web
 * because a page existed that could show one.
 *
 * The address and the mobile number are absent on purpose and there is no
 * setting that adds them. A teacher's inbox is not a public contact channel,
 * and the site has a Contact page carrying the centre's own address for
 * anybody who needs to write. This also keeps the platform's own rule intact:
 * students reach teachers through the app, not through a scraped address.
 */
export function listPublicTeachers(limit = 60): Promise<PublicTeacher[]> {
  return listAll<PublicTeacher>(COLLECTIONS.publicTeachers, {
    orderByField: 'name',
    direction: 'asc',
    pageSize: limit,
  }).catch((error) => {
    console.warn('[WeeklyClass] could not read public teachers:', error);
    return [];
  });
}

/** Whether this account should appear on the public site at all. */
function teacherIsPublishable(user: Partial<AppUser>): boolean {
  return user.role === 'teacher' && user.status === 'active' && user.publicProfile === true;
}

/**
 * Mirror one teacher, or withdraw the mirror.
 *
 * Called whenever an admin saves a teacher, so switching the toggle off — or
 * suspending the account, or changing the role — takes the profile down at the
 * same moment rather than at the next deploy.
 */
export async function syncPublicTeacher(uid: string, user: Partial<AppUser>): Promise<void> {
  try {
    if (!teacherIsPublishable(user)) {
      await deleteDoc(doc(db, COLLECTIONS.publicTeachers, uid));
      return;
    }

    await setDoc(doc(db, COLLECTIONS.publicTeachers, uid), {
      name: user.fullName ?? '',
      qualification: user.qualification?.trim() || null,
      subjects: user.publicSubjects?.trim() || null,
      deleted: false,
    });
  } catch (error) {
    console.warn(`[WeeklyClass] could not update the public profile for ${uid}:`, error);
  }
}

/** True when this teacher has agreed to be named outside the app. */
async function teacherIsNamedPublicly(teacherId?: string | null): Promise<string | null> {
  if (!teacherId) return null;
  try {
    const teacher = await getById<AppUser>(COLLECTIONS.users, teacherId);
    return teacher && teacherIsPublishable(teacher) ? teacher.fullName : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

/**
 * The syllabus, as far as a visitor may read it.
 *
 * Title, subject, week and length — what a prospectus prints. The lesson's
 * description, its video, its audio and its PDF are all absent from the mirror,
 * so the public page can list the curriculum while the material itself stays
 * where it belongs, with the class it was written for.
 */
export function listPublicLessons(limit = 60): Promise<PublicLesson[]> {
  return listAll<PublicLesson>(COLLECTIONS.publicLessons, {
    orderByField: 'weekNumber',
    direction: 'asc',
    pageSize: limit,
  }).catch((error) => {
    console.warn('[WeeklyClass] could not read public lessons:', error);
    return [];
  });
}

/**
 * Mirror one lesson's headline, or withdraw it.
 *
 * Only published lessons are mirrored: a draft is a work in progress and has
 * no business being advertised. Unpublishing removes the public copy, so a
 * lesson pulled back from a class disappears from the website in the same
 * action rather than lingering there.
 */
export async function syncPublicLesson(id: string, lesson: Partial<Lesson>): Promise<void> {
  try {
    if (lesson.status !== 'published' || lesson.deleted) {
      await deleteDoc(doc(db, COLLECTIONS.publicLessons, id));
      return;
    }

    // Both names are looked up rather than copied from the form, because the
    // form holds ids. The class name is public already; the teacher's is used
    // only where that teacher has opted into being named.
    const [className, teacherName] = await Promise.all([
      lesson.classId
        ? getById<ClassRoom>(COLLECTIONS.classes, lesson.classId)
            .then((room) => room?.name ?? null)
            .catch(() => null)
        : Promise.resolve(null),
      teacherIsNamedPublicly(lesson.teacherId),
    ]);

    await setDoc(doc(db, COLLECTIONS.publicLessons, id), {
      title: lesson.title ?? '',
      subject: lesson.subject?.trim() || null,
      weekNumber: lesson.weekNumber ?? 1,
      duration: lesson.duration ?? null,
      language: lesson.language ?? 'en',
      className,
      teacherName,
      deleted: false,
    });
  } catch (error) {
    console.warn(`[WeeklyClass] could not update the public copy of lesson ${id}:`, error);
  }
}

/** Take a lesson's public copy down, for when the lesson itself is deleted. */
export async function removePublicLesson(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTIONS.publicLessons, id));
  } catch (error) {
    console.warn(`[WeeklyClass] could not withdraw public lesson ${id}:`, error);
  }
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

/**
 * The class groups on offer.
 *
 * No mirror here, because there is nothing to strip: `classes` is already
 * world-readable, and has been since the registration screen — which runs
 * signed out — needed to show somebody the group they were about to join and
 * the teachers who run it. This reads the same documents that screen does.
 */
export function listPublicClassRooms(limit = 60): Promise<ClassRoom[]> {
  return listAll<ClassRoom>(COLLECTIONS.classes, {
    filters: [['status', '==', 'active']],
    orderByField: 'name',
    direction: 'asc',
    pageSize: limit,
  }).catch((error) => {
    console.warn('[WeeklyClass] could not read the class list:', error);
    return [];
  });
}
