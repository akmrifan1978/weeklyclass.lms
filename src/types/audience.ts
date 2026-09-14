import type { AppUser } from './models';

/**
 * Who a published thing is for.
 *
 * Several features now need the same three answers — everyone, these
 * classes, or these named people — so the shape is defined once here and
 * reused rather than re-invented per collection.
 *
 * THE QUERY PROBLEM, and why `audienceKeys` exists.
 *
 * Firestore cannot express "classId is null OR classId is mine", and it
 * cannot range-filter two fields at once. A student opening their list would
 * otherwise need three separate queries merged on the device, each with its
 * own index and its own round-trip to Mumbai.
 *
 * So the audience is flattened at write time into one array of opaque keys:
 *
 *     everyone           ->  ['all']
 *     two classes        ->  ['class:abc', 'class:def']
 *     three students     ->  ['user:uid1', 'user:uid2', 'user:uid3']
 *
 * and a student reads their list with a single `array-contains-any` against
 * the at most three keys that can possibly match them. One query, one index,
 * one crossing.
 *
 * The same expression fits in a security rule, which is the real reason for
 * the shape. A rule can check `audienceKeys.hasAny([...])` cheaply and with
 * no extra document reads, so "only the students it was sent to" is enforced
 * by the database rather than by a screen choosing not to show it.
 */

export type AudienceMode = 'all' | 'classes' | 'students';

export interface Audience {
  mode: AudienceMode;
  /** Meaningful when mode is `classes`. */
  classIds?: string[];
  /** Meaningful when mode is `students`. */
  studentIds?: string[];
}

/** Everyone, which is the sensible thing to start a new form on. */
export const EVERYONE: Audience = { mode: 'all' };

/** The flattened form written to the document. See the note above. */
export function audienceKeys(audience: Audience): string[] {
  if (audience.mode === 'classes') {
    return unique(audience.classIds ?? []).map((id) => `class:${id}`);
  }
  if (audience.mode === 'students') {
    return unique(audience.studentIds ?? []).map((uid) => `user:${uid}`);
  }
  return ['all'];
}

/**
 * The keys that can match this person.
 *
 * At most three, which is what keeps the student's query to a single
 * `array-contains-any` — the limit there is thirty, so there is room to
 * spare if a student ever belongs to more than one class.
 */
export function keysForUser(user: Pick<AppUser, 'uid' | 'classId'> | null): string[] {
  // A guest has no account, so nothing can be addressed to them by name. Asking
  // for 'user:guest' as well would make the query unprovable against the rule,
  // and Firestore refuses a query it cannot prove — the whole list, not one row.
  if (!user || user.uid === 'guest') return ['all'];
  const keys = ['all', `user:${user.uid}`];
  if (user.classId) keys.push(`class:${user.classId}`);
  return keys;
}

/**
 * Whether this person is in the audience.
 *
 * Used for the handful of checks that happen after documents are already in
 * hand — a deep link opened directly, or a list that mixes sources — not as a
 * substitute for the query or the rule.
 */
export function audienceIncludes(
  keys: string[] | undefined,
  user: Pick<AppUser, 'uid' | 'classId'> | null
): boolean {
  // An older document saved before audiences existed was visible to everyone,
  // and silently hiding it on upgrade would look like data loss.
  if (!keys || keys.length === 0) return true;
  const mine = keysForUser(user);
  return keys.some((key) => mine.includes(key));
}

/**
 * Reads the audience back off a stored document.
 *
 * The three fields are stored flat rather than as a nested object so that a
 * security rule can read them without indexing into a map, and so a partial
 * update can change the audience without rewriting the rest.
 */
export function audienceFrom(doc: {
  audienceMode?: AudienceMode;
  audienceClassIds?: string[];
  audienceStudentIds?: string[];
}): Audience {
  return {
    mode: doc.audienceMode ?? 'all',
    classIds: doc.audienceClassIds ?? [],
    studentIds: doc.audienceStudentIds ?? [],
  };
}

/** The fields to write. Always produced together so they cannot disagree. */
export function audienceFields(audience: Audience): {
  audienceMode: AudienceMode;
  audienceClassIds: string[];
  audienceStudentIds: string[];
  audienceKeys: string[];
} {
  // Only the list belonging to the chosen mode is kept. Leaving a stale list
  // of student ids behind on a document now addressed to a whole class would
  // be read later as if it still meant something.
  return {
    audienceMode: audience.mode,
    audienceClassIds: audience.mode === 'classes' ? unique(audience.classIds ?? []) : [],
    audienceStudentIds: audience.mode === 'students' ? unique(audience.studentIds ?? []) : [],
    audienceKeys: audienceKeys(audience),
  };
}

/**
 * Whether the audience is complete enough to publish.
 *
 * "Selected students" with nobody selected is not a narrow audience, it is a
 * mistake — publishing it would send the thing to no one at all while looking
 * like it had been sent.
 */
export function audienceIsUsable(audience: Audience): boolean {
  if (audience.mode === 'classes') return (audience.classIds ?? []).length > 0;
  if (audience.mode === 'students') return (audience.studentIds ?? []).length > 0;
  return true;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
