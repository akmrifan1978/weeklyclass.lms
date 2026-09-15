import { initializeApp, deleteApp, getApps } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db, firebaseConfig } from '@/firebase/config';
import { COLLECTIONS, DEFAULT_LANGUAGE, PAGE_SIZE } from '@/constants/app';
import { accountSearchTokens } from '@/utils/format';
import { cleanDial, phoneSearchTerm, toE164 } from '@/utils/phone';
import { AppError } from '@/utils/errors';
import { usernameSchema } from '@/utils/validation';
import { DEFAULT_TEACHER_PERMISSIONS, allPermissions } from '@/types/permissions';
import type {
  AppUser,
  ClassRoom,
  LanguageCode,
  Permission,
  PermissionMap,
  UserRole,
  UserStatus,
} from '@/types';

import {
  batchWrite,
  getById,
  listAll,
  listPage,
  softDelete,
  updateDocById,
  type Cursor,
  type Page,
} from './firestore';
import {
  altAuthEmailForMobile,
  authEmailForMobile,
  claimIdentity,
  isMobileAvailable,
  isUsernameAvailable,
  MOBILES,
  moveMobileClaim,
  nextSequentialId,
  normaliseMobile,
  normaliseUsername,
  releaseAccountIdentity,
} from './identityService';
import * as audit from './auditService';
import { syncPublicTeacher } from './publicSiteService';

/**
 * User management for admins (and for teachers holding the matching
 * VIEW_/CREATE_/EDIT_ permissions).
 */

export interface UserQuery {
  role?: UserRole;
  status?: UserStatus;
  branchId?: string;
  classId?: string;
  country?: string;
  /** Prefix search over name / username / email / generated id. */
  search?: string;
  cursor?: Cursor;
  pageSize?: number;
  includeDeleted?: boolean;
}

export function listUsers(options: UserQuery = {}): Promise<Page<AppUser>> {
  // A number is searched in the digits the index holds, so "+966 56 756 0387",
  // "0567560387" and "00966567560387" all find the same person.
  const typed = options.search?.trim().toLowerCase();
  const term = typed ? (phoneSearchTerm(typed) ?? typed) : typed;
  return listPage<AppUser>(COLLECTIONS.users, {
    filters: [
      options.role ? ['role', '==', options.role] : null,
      options.status ? ['status', '==', options.status] : null,
      options.branchId ? ['branchId', '==', options.branchId] : null,
      options.classId ? ['classId', '==', options.classId] : null,
      options.country ? ['country', '==', options.country] : null,
      term ? ['searchTokens', 'array-contains', term] : null,
    ],
    // A prefix search already narrows heavily; ordering by name keeps the
    // composite index small and the result stable.
    orderByField: term ? undefined : 'fullName',
    direction: 'asc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? PAGE_SIZE,
    excludeDeleted: !options.includeDeleted,
  });
}

export function getUser(uid: string): Promise<AppUser | null> {
  return getById<AppUser>(COLLECTIONS.users, uid);
}

export function listStudentsOfClass(classId: string, pageSize = 200): Promise<Page<AppUser>> {
  return listPage<AppUser>(COLLECTIONS.users, {
    filters: [
      ['role', '==', 'student'],
      ['classId', '==', classId],
      ['status', '==', 'active'],
    ],
    orderByField: 'fullName',
    direction: 'asc',
    pageSize,
  });
}

export async function updateUser(
  uid: string,
  changes: Partial<AppUser>,
  actor: AppUser
): Promise<void> {
  const before = await getUser(uid);
  if (!before) throw new AppError('errors.notFound', 'not-found');

  const payload: Partial<AppUser> & { searchTokens?: string[] } = { ...changes };

  /*
   * Moving a student to a different group moves their teachers with them.
   *
   * The allocation is copied onto the student so that lists do not have to
   * resolve a class per row, and a copy that is not maintained is worse than
   * no copy at all — it would show an admin the name of somebody who stopped
   * teaching this student the moment they were moved.
   *
   * Only when the class actually changes, and only for students. A teacher's
   * own record has no allocation to keep.
   */
  const targetRole = changes.role ?? before.role;
  const classChanged = changes.classId !== undefined && changes.classId !== before.classId;
  if (targetRole === 'student' && classChanged) {
    const group = changes.classId
      ? await getById<ClassRoom>(COLLECTIONS.classes, changes.classId).catch(() => null)
      : null;
    payload.assignedTeacherIds = group?.teacherIds ?? [];
    payload.assignedTeacherNames = group?.teacherNames ?? [];
  }

  /*
   * A changed number moves its sign-in row FIRST, in its own transaction.
   *
   * First, because the move is also the uniqueness check: a number that
   * already belongs to somebody else fails here, before anything about the
   * profile is saved. Saving the profile first is how an account used to end
   * up showing a number that signed in to somebody else - and why the old
   * number stayed "already registered" to nobody visible.
   */
  const numberTouched = changes.mobile !== undefined || changes.mobileCountryCode !== undefined;
  if (numberTouched) {
    const nextMobile = (changes.mobile ?? before.mobile ?? '').trim();
    const nextDial = changes.mobileCountryCode ?? before.mobileCountryCode;
    if (nextMobile) {
      await moveMobileClaim({
        uid,
        username: before.username,
        authEmail: before.authEmail ?? before.email,
        from: { mobile: before.mobile, dial: before.mobileCountryCode },
        to: { mobile: nextMobile, dial: nextDial },
      });
      payload.mobileCountryCode = cleanDial(nextDial);
      payload.mobileE164 = toE164(nextMobile, nextDial);
    }
  }

  if (changes.fullName || changes.username || changes.email || numberTouched) {
    payload.searchTokens = accountSearchTokens({ ...before, ...payload });
  }

  await updateDocById<AppUser>(COLLECTIONS.users, uid, payload);
  // Keeps the public website in step with the account. Merged with `before`
  // because a save that touches only the name still has to know whether this
  // person is published, and a save that switches publishing off has to be
  // able to take the profile down.
  await syncPublicTeacher(uid, { ...before, ...payload });
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.users,
    documentId: uid,
    summary: `Updated ${before.fullName}`,
    changes: audit.diff(
      before as unknown as Record<string, unknown>,
      changes as unknown as Record<string, unknown>
    ),
  });
}

/**
 * Changes an account's username, and nothing else about it.
 *
 * WHAT THIS DOES NOT TOUCH, because the whole risk of renaming is that it
 * quietly breaks something adjacent: the password, the role, the permission
 * map, the class, and every record the account has ever produced. None of them
 * are keyed by username. Sign-in is not either — an account authenticates with
 * `authEmail`, and the username is only the label used to LOOK UP that address
 * in the `usernames` index. Moving the index row moves the label; the account
 * underneath is untouched.
 *
 * The old row is deleted and the new one written in one transaction, so a
 * failure cannot leave a person with two usernames or none.
 *
 * WHO MAY DO IT is decided by firestore.rules, not here: your own, or anybody's
 * if you are a super admin. This checks the same thing first so the refusal is
 * a sentence rather than a permission error, but the rule is what enforces it.
 */
export async function changeUsername(
  uid: string,
  requested: string,
  actor: AppUser
): Promise<void> {
  const before = await getUser(uid);
  if (!before) throw new AppError('errors.notFound', 'not-found');

  /*
   * Who may rename whom.
   *
   * Yourself, always. An admin, anybody who is not an admin - every student
   * and teacher, as the centre asked. Another ADMIN's username stays
   * super-admin work: that check exists so one admin cannot quietly change
   * how another signs in, and it is kept. firestore.rules says the same.
   */
  const isSelf = actor.uid === uid;
  const adminRenamingMember = actor.role === 'admin' && before.role !== 'admin';
  if (!isSelf && !adminRenamingMember && actor.superAdmin !== true) {
    throw new AppError('admin.usernameNotYours', 'permission-denied');
  }

  const next = normaliseUsername(requested);
  const parsed = usernameSchema.safeParse(next);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'validation.usernameInvalid', 'invalid-argument');
  }

  const current = normaliseUsername(before.username ?? '');
  if (next === current) return;

  const nextRef = doc(db, COLLECTIONS.usernames, next);
  const currentRef = doc(db, COLLECTIONS.usernames, current);
  const userRef = doc(db, COLLECTIONS.users, uid);

  await runTransaction(db, async (tx) => {
    // Read before write, as a transaction requires. Somebody else may have
    // taken the name between the form being filled in and this running.
    const taken = await tx.get(nextRef);
    if (taken.exists() && taken.data().uid !== uid) {
      throw new AppError('validation.usernameTaken', 'already-exists');
    }

    const old = current ? await tx.get(currentRef) : null;

    // The number's row carries the username too - it is what "forgot
    // username" answers with - so it moves in the same transaction.
    const numberRef = before.mobile
      ? doc(db, MOBILES, normaliseMobile(before.mobile, before.mobileCountryCode))
      : null;
    const numberRow = numberRef ? await tx.get(numberRef) : null;

    tx.set(nextRef, {
      uid,
      email: before.email ?? '',
      // Carried across unchanged. This is the address the account actually
      // signs in with, and renaming must not disturb it.
      authEmail: before.authEmail ?? before.email ?? '',
      role: before.role,
      createdAt: old?.exists() ? old.data().createdAt : serverTimestamp(),
    });

    // Only when it was really this account's. Deleting a row pointing at
    // somebody else would hand them a broken login.
    if (old?.exists() && old.data().uid === uid) tx.delete(currentRef);

    if (numberRef && numberRow?.exists() && numberRow.data().uid === uid) {
      tx.update(numberRef, { username: next });
    }

    tx.update(userRef, {
      username: next,
      searchTokens: accountSearchTokens({ ...before, username: next }),
      updatedAt: serverTimestamp(),
    });
  });

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.users,
    documentId: uid,
    summary: isSelf
      ? `Changed own username from "${current}" to "${next}"`
      : `Changed ${before.fullName}'s username from "${current}" to "${next}"`,
    changes: { username: { from: current, to: next } },
  });
}

export async function setStatus(
  uid: string,
  status: UserStatus,
  actor: AppUser
): Promise<void> {
  const before = await getUser(uid);
  if (!before) throw new AppError('errors.notFound', 'not-found');

  await updateDoc(doc(db, COLLECTIONS.users, uid), { status, updatedAt: serverTimestamp() });
  // Suspending a teacher takes their public profile down with them. An account
  // that can no longer sign in should not still be advertised as staff.
  await syncPublicTeacher(uid, { ...before, status });
  await audit.log({
    actor,
    action: status === 'active' ? 'ACTIVATE' : 'DEACTIVATE',
    collection: COLLECTIONS.users,
    documentId: uid,
    summary: `${before.fullName}: status ${before.status} -> ${status}`,
    changes: { status: { from: before.status, to: status } },
  });
}

/** Approving a pending registration is just an activation with an audit note. */
export function approveUser(uid: string, actor: AppUser): Promise<void> {
  return setStatus(uid, 'active', actor);
}

export async function updatePermissions(
  uid: string,
  permissions: PermissionMap,
  actor: AppUser
): Promise<void> {
  const before = await getUser(uid);
  if (!before) throw new AppError('errors.notFound', 'not-found');
  if (before.role === 'admin') {
    // Admins hold everything implicitly; storing a partial map would be a lie.
    throw new AppError('admin.permissionsAdminNote', 'failed-precondition');
  }

  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    permissions,
    updatedAt: serverTimestamp(),
  });

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([
    ...Object.keys(before.permissions ?? {}),
    ...Object.keys(permissions),
  ]) as Set<Permission>;
  for (const key of keys) {
    const from = before.permissions?.[key] ?? false;
    const to = permissions[key] ?? false;
    if (from !== to) changed[key] = { from, to };
  }

  await audit.log({
    actor,
    action: 'PERMISSION_CHANGED',
    collection: COLLECTIONS.users,
    documentId: uid,
    summary: `Permissions changed for ${before.fullName}`,
    changes: changed,
  });
}

/** Soft-deletes the profile. The Firebase Auth account is left intact. */
export async function removeUser(uid: string, actor: AppUser): Promise<void> {
  const before = await getUser(uid);
  await softDelete(COLLECTIONS.users, uid, actor.uid);
  await updateDoc(doc(db, COLLECTIONS.users, uid), { status: 'inactive' });
  await syncPublicTeacher(uid, { ...before, publicProfile: false });
  // The number and username go back to the pool. The dashboard no longer
  // shows this account, so nothing should still be holding them for it - this
  // is the "already registered, but nowhere in the dashboard" people hit.
  if (before) {
    await releaseAccountIdentity(before).catch((error) =>
      console.warn('[WeeklyClass] could not release the removed account\'s number and username', error)
    );
  }
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.users,
    documentId: uid,
    summary: `Removed ${before?.fullName ?? uid}`,
  });
}

export function sendResetEmail(email: string): Promise<void> {
  const secondary = getAuth();
  return sendPasswordResetEmail(secondary, email.trim().toLowerCase());
}

export interface AdminCreateUserInput {
  role: Extract<UserRole, 'student' | 'teacher'>;
  fullName: string;
  username: string;
  email: string;
  password: string;
  mobile: string;
  /** "+966". */
  mobileCountryCode?: string | null;
  country: string;
  language?: LanguageCode;
  branchId?: string | null;
  classId?: string | null;
  dateOfBirth?: string | null;
  gender?: 'male' | 'female' | null;
  qualification?: string;
  status?: UserStatus;
  permissions?: PermissionMap;
}

/**
 * Creates an account on someone else's behalf.
 *
 * `createUserWithEmailAndPassword` signs the new account in on whichever
 * Firebase app instance it runs against — which would kick the admin out of
 * their own session. So the call runs against a throwaway secondary app that is
 * signed out and destroyed immediately afterwards. This keeps account creation
 * on the free Spark plan; with billing enabled the same job is better done by a
 * Cloud Function using the Admin SDK (see docs/FIREBASE.md).
 */
export async function createUserAsAdmin(
  input: AdminCreateUserInput,
  actor: AppUser
): Promise<{ uid: string; generatedId: string }> {
  const appName = `admin-create-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const email = input.email.trim().toLowerCase();
    const username = normaliseUsername(input.username);
    const dial = cleanDial(input.mobileCountryCode);

    /*
     * Checked BEFORE anything is created.
     *
     * The profile used to be saved first and the number checked afterwards, so
     * a number already in use failed only once the new account already stood
     * in the dashboard - a half-made teacher whose number signed in to somebody
     * else, and a retry that added a second. Now a taken number or username
     * stops here, and there is nothing to clean up.
     *
     * The transaction in claimIdentity is still the real guard, for the moment
     * between this check and that write.
     */
    const [mobileFree, usernameFree] = await Promise.all([
      isMobileAvailable(input.mobile, dial).catch(() => true),
      isUsernameAvailable(username).catch(() => true),
    ]);
    if (!mobileFree) throw new AppError('validation.mobileTaken', 'already-exists');
    if (!usernameFree) throw new AppError('validation.usernameTaken', 'already-exists');

    // Same rule as self-registration: the mobile number is the unique identity,
    // an email address may be shared. Where Firebase Auth refuses a second
    // account on an address it already holds, the account signs in under one
    // derived from its mobile number instead. See identityService.
    //
    // And where there is no address at all - which is allowed, because plenty
    // of teachers do not have one - the same derived address is used from the
    // start.
    const signInAddress = email || authEmailForMobile(input.mobile, dial);
    let authEmail = signInAddress;
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        signInAddress,
        input.password
      );
    } catch (error) {
      if ((error as { code?: string })?.code !== 'auth/email-already-in-use') throw error;
      authEmail = authEmailForMobile(input.mobile, dial);
      try {
        credential = await createUserWithEmailAndPassword(secondaryAuth, authEmail, input.password);
      } catch (second) {
        if ((second as { code?: string })?.code !== 'auth/email-already-in-use') throw second;
        // The number's own address is held by an old sign-in with no account
        // behind it: a removed account, or an attempt that never finished. The
        // number was checked as free a moment ago, so a fresh address is used.
        authEmail = altAuthEmailForMobile(input.mobile, dial);
        credential = await createUserWithEmailAndPassword(secondaryAuth, authEmail, input.password);
      }
    }
    const uid = credential.user.uid;

    /*
     * The username and number are claimed before the profile exists. If either
     * was taken in the moment since the check, this fails and the new sign-in -
     * which nobody has ever used - is deleted again, so no half-made account is
     * left behind in the dashboard.
     */
    try {
      await claimIdentity({
        username,
        email,
        authEmail,
        uid,
        role: input.role,
        mobile: input.mobile,
        mobileCountryCode: dial,
      });
    } catch (error) {
      await credential.user.delete().catch(() => undefined);
      throw error;
    }

    let generatedId: string;
    try {
      generatedId = await nextSequentialId(input.role === 'student' ? 'STU' : 'TCH');

      // A student's teachers come with their class, exactly as when a student
      // registers themselves.
      const group =
        input.role === 'student' && input.classId
          ? await getById<ClassRoom>(COLLECTIONS.classes, input.classId).catch(() => null)
          : null;

      const profile: Record<string, unknown> = {
        uid,
        fullName: input.fullName.trim(),
        username,
        email,
        authEmail,
        mobile: input.mobile.trim(),
        mobileCountryCode: dial,
        mobileE164: toE164(input.mobile, dial),
        role: input.role,
        status: input.status ?? 'active',
        country: input.country,
        language: input.language ?? DEFAULT_LANGUAGE,
        profileImage: null,
        branchId: input.branchId ?? null,
        classId: input.role === 'student' ? (input.classId ?? null) : null,
        classIds: input.role === 'teacher' ? [] : [],
        permissions:
          input.permissions ??
          (input.role === 'teacher' ? { ...DEFAULT_TEACHER_PERMISSIONS } : {}),
        deleted: false,
        searchTokens: accountSearchTokens({
          fullName: input.fullName,
          username,
          email,
          studentId: generatedId,
          mobile: input.mobile,
          mobileCountryCode: dial,
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: actor.uid,
        ...(input.role === 'student'
          ? {
              studentId: generatedId,
              dateOfBirth: input.dateOfBirth ?? null,
              gender: input.gender ?? null,
              assignedTeacherIds: group?.teacherIds ?? [],
              assignedTeacherNames: group?.teacherNames ?? [],
            }
          : { teacherId: generatedId, qualification: input.qualification ?? '' }),
      };

      // Written by the admin's own session, so admin rules apply.
      await import('./firestore').then((fs) =>
        fs.setDocById(COLLECTIONS.users, uid, profile, { actorId: actor.uid })
      );
    } catch (error) {
      // Undone in reverse, so a retry starts from nothing.
      await releaseAccountIdentity({
        uid,
        username,
        email,
        mobile: input.mobile,
        mobileCountryCode: dial,
      }).catch(() => undefined);
      await credential.user.delete().catch(() => undefined);
      throw error;
    }

    await audit.log({
      actor,
      action: 'CREATE',
      collection: COLLECTIONS.users,
      documentId: uid,
      summary: `Created ${input.role} ${input.fullName}`,
    });

    return { uid, generatedId };
  } finally {
    await fbSignOut(secondaryAuth).catch(() => undefined);
    const stillRegistered = getApps().find((a) => a.name === appName);
    if (stillRegistered) await deleteApp(stillRegistered).catch(() => undefined);
  }
}

/** Effective permission set: admins hold everything, others hold their map. */
export function effectivePermissions(user: AppUser | null): PermissionMap {
  if (!user) return {};
  if (user.role === 'admin') return allPermissions();
  return user.permissions ?? {};
}

export function hasPermission(user: AppUser | null, permission: Permission): boolean {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  return user.permissions?.[permission] === true;
}

/**
 * Stores one dashboard's language choice on the profile, so it follows the
 * person to another device.
 *
 * Deliberately silent on failure. The device's own copy is what every screen
 * reads; this is a convenience on top of it, and a refused or offline write must
 * never surface as an error over something as ordinary as picking a language.
 */
export async function saveDashboardLanguage(
  uid: string,
  scope: string,
  code: LanguageCode
): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      [`dashboardLanguages.${scope}`]: code,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Nothing to do — the choice already applies on this device.
  }
}

// ---------------------------------------------------------------------------
// Requiring a new password
// ---------------------------------------------------------------------------

/**
 * Marks accounts as needing a new password at their next sign-in.
 *
 * WHAT THIS DOES AND, IMPORTANTLY, WHAT IT DOES NOT. It sets a flag that the
 * app honours: the person signs in as usual and is then held on a change-
 * password screen until they set a new one. It does NOT invalidate the old
 * password, because a client cannot. Only the Firebase Admin SDK can set
 * another account's password, and that needs a trusted machine — see
 * scripts/send-push.js for the pattern if that is ever wanted.
 *
 * So this is the honest shape of it: everybody is forced to choose a new
 * password before they can use the app again, and the old one still opens the
 * door until they do. For "everyone must re-secure their account" that is
 * enough. For "this password is compromised and must stop working this second"
 * it is not, and nothing that runs in a browser could be.
 *
 * Nobody's existing password is read, shown or stored anywhere by this.
 */
export async function requirePasswordChange(
  uids: string[],
  actor: AppUser
): Promise<number> {
  if (uids.length === 0) return 0;

  await batchWrite(
    uids.map((uid) => ({
      type: 'update' as const,
      path: COLLECTIONS.users,
      id: uid,
      data: { mustChangePassword: true, updatedAt: serverTimestamp() },
    }))
  );

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.users,
    documentId: uids.length === 1 ? uids[0] : undefined,
    summary:
      uids.length === 1
        ? 'Required a new password at next sign-in'
        : `Required a new password at next sign-in for ${uids.length} accounts`,
  });

  return uids.length;
}

/**
 * The same, for everybody.
 *
 * The actor is skipped. An admin locking themselves out of the tool they are
 * standing in, in the same click that secures everybody else, is not a helpful
 * outcome — they can require it of themselves individually if they mean to.
 */
export async function requirePasswordChangeForAll(actor: AppUser): Promise<number> {
  const everyone = await listAll<AppUser>(COLLECTIONS.users, { pageSize: 1000 });
  const targets = everyone.map((row) => row.uid).filter((uid) => uid && uid !== actor.uid);
  return requirePasswordChange(targets, actor);
}

/** Clears the flag. Called once a new password has actually been set. */
export async function clearPasswordChangeRequirement(uid: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    mustChangePassword: false,
    updatedAt: serverTimestamp(),
  }).catch(() => undefined);
}
