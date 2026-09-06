import { initializeApp, deleteApp, getApps } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db, firebaseConfig } from '@/firebase/config';
import { COLLECTIONS, DEFAULT_LANGUAGE, PAGE_SIZE } from '@/constants/app';
import { searchTokens } from '@/utils/format';
import { AppError } from '@/utils/errors';
import { DEFAULT_TEACHER_PERMISSIONS, allPermissions } from '@/types/permissions';
import type { AppUser, LanguageCode, Permission, PermissionMap, UserRole, UserStatus } from '@/types';

import { getById, listPage, softDelete, updateDocById, type Cursor, type Page } from './firestore';
import {
  authEmailForMobile,
  claimIdentity,
  nextSequentialId,
  normaliseUsername,
} from './identityService';
import * as audit from './auditService';

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
  const term = options.search?.trim().toLowerCase();
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
  if (changes.fullName || changes.username || changes.email) {
    payload.searchTokens = searchTokens(
      changes.fullName ?? before.fullName,
      changes.username ?? before.username,
      changes.email ?? before.email,
      before.studentId ?? before.teacherId
    );
  }

  await updateDocById<AppUser>(COLLECTIONS.users, uid, payload);
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

export async function setStatus(
  uid: string,
  status: UserStatus,
  actor: AppUser
): Promise<void> {
  const before = await getUser(uid);
  if (!before) throw new AppError('errors.notFound', 'not-found');

  await updateDoc(doc(db, COLLECTIONS.users, uid), { status, updatedAt: serverTimestamp() });
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

    // Same rule as self-registration: the mobile number is the unique identity,
    // an email address may be shared. Where Firebase Auth refuses a second
    // account on an address it already holds, the account signs in under one
    // derived from its mobile number instead. See identityService.
    //
    // And where there is no address at all — which is now allowed, because
    // plenty of teachers do not have one — the same derived address is used
    // from the start. Without this, an admin adding a teacher with the email
    // blank got `auth/missing-email`, which reached them as "something went
    // wrong" and named nothing.
    const signInAddress = email || authEmailForMobile(input.mobile);
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
      authEmail = authEmailForMobile(input.mobile);
      credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        authEmail,
        input.password
      );
    }
    const uid = credential.user.uid;
    const generatedId = await nextSequentialId(input.role === 'student' ? 'STU' : 'TCH');

    const profile: Record<string, unknown> = {
      uid,
      fullName: input.fullName.trim(),
      username,
      email,
      authEmail,
      mobile: input.mobile.trim(),
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
      searchTokens: searchTokens(input.fullName, username, email, generatedId),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: actor.uid,
      ...(input.role === 'student'
        ? {
            studentId: generatedId,
            dateOfBirth: input.dateOfBirth ?? null,
            gender: input.gender ?? null,
          }
        : { teacherId: generatedId, qualification: input.qualification ?? '' }),
    };

    // Written by the admin's own session, so admin rules apply.
    await import('./firestore').then((fs) =>
      fs.setDocById(COLLECTIONS.users, uid, profile, { actorId: actor.uid })
    );
    await claimIdentity({
      username,
      email,
      authEmail,
      uid,
      role: input.role,
      mobile: input.mobile,
    });

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
