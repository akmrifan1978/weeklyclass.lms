import { collection, getDocs, query, where, writeBatch, limit } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS, APP_SETTINGS_DOC, DEFAULT_SETTINGS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type { AppUser } from '@/types';

import { setDocById } from './firestore';
import { clearSettingsCache } from './settingsService';
import * as audit from './auditService';

/**
 * Emptying the platform.
 *
 * This is the most destructive thing in the app, so it is written to be read
 * rather than to be clever. Two levels, and the difference between them is the
 * question "is this the same institution starting a new year, or a different
 * institution entirely?"
 *
 *   Reset    — every record of people and their work, and all the content.
 *              Admin accounts, the branches and classes they are organised
 *              into, and the platform's own settings survive.
 *   Factory  — the above plus the structure and the settings, back to the
 *              state of a fresh install.
 *
 * Both are permanent. Firestore has no undo and this app has no backup, so the
 * screen that calls this counts the documents first and makes somebody type the
 * word — see the honest limits at the bottom of this file.
 */

/** What each level clears, in the order it is cleared. */
const ACTIVITY: string[] = [
  COLLECTIONS.eventRegistrations,
  COLLECTIONS.calendarEvents,
  COLLECTIONS.attendance,
  COLLECTIONS.quizAttempts,
  COLLECTIONS.results,
  COLLECTIONS.questions,
  COLLECTIONS.quizzes,
  COLLECTIONS.supportRequests,
  COLLECTIONS.qaQuestions,
  COLLECTIONS.notifications,
  COLLECTIONS.announcements,
];

const CONTENT: string[] = [
  COLLECTIONS.lessons,
  COLLECTIONS.videos,
  COLLECTIONS.articles,
  COLLECTIONS.materials,
];

/**
 * Cleared after the users themselves, never before.
 *
 * These three index a username, an email and a phone number to an account. If
 * they outlived the accounts they name, every one of those identifiers would
 * stay claimed forever and nobody could re-register with their own number.
 */
const IDENTITY: string[] = [COLLECTIONS.usernames, 'emailLookup', 'mobiles'];

const STRUCTURE: string[] = [
  COLLECTIONS.classes,
  COLLECTIONS.branches,
  COLLECTIONS.subjects,
  COLLECTIONS.organizations,
  COLLECTIONS.counters,
];

export type ResetLevel = 'data' | 'factory';

/** Everything a level touches, apart from the user documents themselves. */
export function collectionsFor(level: ResetLevel): string[] {
  const base = [...ACTIVITY, ...CONTENT, ...IDENTITY];
  return level === 'factory' ? [...base, ...STRUCTURE] : base;
}

export interface ResetTally {
  /** Documents per collection, only those that have any. */
  counts: Record<string, number>;
  /** Student and teacher accounts that would be removed. */
  people: number;
  total: number;
}

/**
 * Counts what is about to be destroyed.
 *
 * Shown before the confirmation, because "this will delete 830 videos" is a
 * sentence that stops the wrong person, and "this will delete your data" is not.
 */
export async function tally(level: ResetLevel): Promise<ResetTally> {
  const counts: Record<string, number> = {};

  for (const path of collectionsFor(level)) {
    const snap = await getDocs(collection(db, path)).catch(() => null);
    if (snap && snap.size > 0) counts[path] = snap.size;
  }

  const people = await countPeople();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0) + people;
  return { counts, people, total };
}

async function countPeople(): Promise<number> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.users), where('role', '!=', 'admin'))
  ).catch(() => null);
  return snap?.size ?? 0;
}

export interface ResetProgress {
  /** The collection being cleared right now. */
  step: string;
  done: number;
  total: number;
}

export interface ResetOutcome {
  removed: number;
  /**
   * Collections that refused to empty, usually a permission the acting admin
   * does not hold. Surfaced rather than swallowed: a reset that quietly left
   * half the data behind is worse than one that says which half.
   */
  failed: string[];
}

/**
 * Clears the platform. There is no way back from this.
 *
 * Admin accounts are never touched, at any level. An institution that wiped
 * itself and locked out its own administrators in the same action would have
 * no way to sign back in and start again.
 */
export async function reset(
  level: ResetLevel,
  actor: AppUser,
  onProgress?: (progress: ResetProgress) => void
): Promise<ResetOutcome> {
  if (actor.role !== 'admin') {
    throw new AppError('errors.permissionDenied', 'permission-denied');
  }

  // Logged BEFORE the work, not after. A reset that dies halfway still needs to
  // have left a record that somebody started it — and the audit collection is
  // deliberately not among the things being cleared.
  await audit
    .log({
      actor,
      action: 'DELETE',
      collection: COLLECTIONS.settings,
      documentId: level,
      summary: `${actor.fullName} began a ${level === 'factory' ? 'factory reset' : 'data reset'}`,
    })
    .catch(() => undefined);

  const steps = [...collectionsFor(level)];
  const failed: string[] = [];
  let removed = 0;
  let index = 0;

  // People first, because the identity indexes must not be cleared while the
  // accounts they point at are still live. This one is allowed to throw: if the
  // acting admin cannot delete a user there is no point emptying anything else.
  onProgress?.({ step: COLLECTIONS.users, done: 0, total: steps.length + 1 });
  removed += await purgeNonAdmins();

  for (const path of steps) {
    index += 1;
    onProgress?.({ step: path, done: index, total: steps.length + 1 });
    try {
      removed += await purge(path);
    } catch {
      // One collection refusing must not strand the rest half-deleted, which
      // would leave the platform in a state nobody chose.
      failed.push(path);
    }
  }

  if (level === 'factory') {
    await setDocById(COLLECTIONS.settings, APP_SETTINGS_DOC, {
      ...DEFAULT_SETTINGS,
      updatedBy: actor.uid,
    });
    clearSettingsCache();
  }

  await audit
    .log({
      actor,
      action: 'DELETE',
      collection: COLLECTIONS.settings,
      documentId: level,
      summary:
        `${actor.fullName} completed a ${level === 'factory' ? 'factory reset' : 'data reset'} — ` +
        `${removed} documents removed` +
        (failed.length > 0 ? `; failed: ${failed.join(', ')}` : ''),
    })
    .catch(() => undefined);

  return { removed, failed };
}

/**
 * The imported talk library.
 *
 * Several hundred recordings were brought in from an outside collection and
 * stored under the kind `noor` — a kind nothing else in this codebase creates.
 * That makes them precisely identifiable, which is the only reason removing
 * them can be offered as a single action rather than as "delete all videos".
 *
 * Nothing the school uploaded is touched: an ordinary recording is `video` or
 * `recording`, never this.
 */
const IMPORTED_KIND = 'noor';

/** How many imported talks are in the library right now. */
export async function countImported(): Promise<number> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.videos), where('kind', '==', IMPORTED_KIND))
  ).catch(() => null);
  return snap?.size ?? 0;
}

/**
 * Removes the imported library and nothing else.
 *
 * Hard delete rather than the soft delete used elsewhere. These were never the
 * school's own work, nobody is going to want one back, and several hundred
 * hidden rows would sit in every future count and export pretending not to be
 * there.
 */
export async function purgeImported(actor: AppUser): Promise<number> {
  if (actor.role !== 'admin') {
    throw new AppError('errors.permissionDenied', 'permission-denied');
  }

  let removed = 0;
  for (;;) {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.videos), where('kind', '==', IMPORTED_KIND), limit(400))
    );
    if (snap.empty) break;

    const batch = writeBatch(db);
    snap.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();

    removed += snap.size;
    if (snap.size < 400) break;
  }

  await audit
    .log({
      actor,
      action: 'DELETE',
      collection: COLLECTIONS.videos,
      documentId: IMPORTED_KIND,
      summary: `${actor.fullName} removed the imported talk library — ${removed} recordings`,
    })
    .catch(() => undefined);

  return removed;
}

/** Deletes every document in a collection, 400 at a time. */
async function purge(path: string): Promise<number> {
  let removed = 0;

  // Re-queried each pass rather than paged with a cursor: the documents the
  // cursor pointed at are the ones just deleted, so "the first 400 that are
  // left" is both simpler and correct.
  for (;;) {
    const snap = await getDocs(query(collection(db, path), limit(400)));
    if (snap.empty) break;

    const batch = writeBatch(db);
    snap.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();

    removed += snap.size;
    if (snap.size < 400) break;
  }

  return removed;
}

/** Everyone except the admins, who have to be able to sign back in. */
async function purgeNonAdmins(): Promise<number> {
  let removed = 0;

  for (;;) {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.users), where('role', '!=', 'admin'), limit(400))
    ).catch(() => null);
    if (!snap || snap.empty) break;

    const batch = writeBatch(db);
    snap.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();

    removed += snap.size;
    if (snap.size < 400) break;
  }

  return removed;
}

/**
 * What this deliberately does NOT do.
 *
 * Firebase Authentication accounts survive. Deleting one needs the Admin SDK,
 * which needs a server this project does not have, so a wiped student can still
 * authenticate — and then finds no profile and cannot get past the sign-in
 * screen. Their email and phone number also stay claimed inside Firebase Auth,
 * so re-registering with the same address will fail until the account is
 * removed by hand in the Firebase console. The screen says so before you start.
 *
 * Uploaded files survive too. Images and PDFs live in Cloud Storage and Firebase
 * has no client API for clearing a bucket, so the documents that referenced them
 * go and the bytes stay. They cost storage but are unreachable from the app.
 */
