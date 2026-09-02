import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { auth, db } from '@/firebase/config';
import { COLLECTIONS, DEFAULT_LANGUAGE } from '@/constants/app';
import { AppError } from '@/utils/errors';
import { searchTokens } from '@/utils/format';
import { isEmail } from '@/utils/validation';
import { DEFAULT_TEACHER_PERMISSIONS } from '@/types/permissions';
import type { AppUser, LanguageCode, UserRole, UserStatus } from '@/types';

import { claimIdentity, emailForUsername, nextSequentialId, normaliseUsername } from './identityService';
import { getSettings } from './settingsService';
import * as audit from './auditService';

/**
 * Authentication.
 *
 * Credentials live only in Firebase Authentication — no password, hash or salt
 * is ever written to Firestore. The `users/{uid}` document holds profile and
 * authorisation data and is created immediately after the auth account.
 */

export interface LoginResult {
  user: AppUser;
  firebaseUser: FirebaseUser;
}

/** Statuses that may sign in. Everything else is refused with a clear reason. */
const LOGIN_BLOCKED: Record<Exclude<UserStatus, 'active'>, string> = {
  pending: 'auth.accountPending',
  suspended: 'auth.accountSuspended',
  inactive: 'auth.accountInactive',
};

export async function fetchProfile(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.users, uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as object) } as AppUser;
}

/**
 * Signs in with either an email address or a username.
 *
 * A username is resolved to its email through the public `usernames` index
 * before authenticating — see identityService for why that is safe.
 */
export async function login(identifier: string, password: string): Promise<LoginResult> {
  const trimmed = identifier.trim();
  let email = trimmed.toLowerCase();

  if (!isEmail(trimmed)) {
    const resolved = await emailForUsername(trimmed);
    if (!resolved) {
      // Same message as a wrong password: do not reveal which usernames exist.
      throw new AppError('errors.invalidCredentials', 'auth/invalid-credential');
    }
    email = resolved;
  }

  const credential = await signInWithEmailAndPassword(auth, email, password);
  const profile = await fetchProfile(credential.user.uid);

  if (!profile) {
    await fbSignOut(auth);
    throw new AppError('errors.generic', 'auth/profile-missing');
  }

  if (profile.status !== 'active') {
    await fbSignOut(auth);
    throw new AppError(LOGIN_BLOCKED[profile.status], 'auth/user-disabled');
  }

  await updateDoc(doc(db, COLLECTIONS.users, profile.uid), {
    lastLoginAt: serverTimestamp(),
  }).catch(() => undefined);

  await audit.log({
    actor: profile,
    action: 'LOGIN',
    collection: COLLECTIONS.users,
    documentId: profile.uid,
    summary: `${profile.fullName} signed in`,
  });

  return { user: profile, firebaseUser: credential.user };
}

export async function logout(actor?: AppUser | null): Promise<void> {
  if (actor) {
    await audit.log({
      actor,
      action: 'LOGOUT',
      collection: COLLECTIONS.users,
      documentId: actor.uid,
      summary: `${actor.fullName} signed out`,
    });
  }
  await fbSignOut(auth);
}

export interface RegistrationInput {
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  country: string;
  language: LanguageCode;
  password: string;
  branchId?: string | null;
  classId?: string | null;
  // Student
  dateOfBirth?: string | null;
  gender?: 'male' | 'female' | null;
  // Teacher
  qualification?: string;
}

export interface RegistrationResult {
  uid: string;
  status: UserStatus;
  generatedId: string;
  /** True when the account must be approved before it can be used. */
  requiresApproval: boolean;
}

/**
 * Self-service registration for students and teachers.
 *
 * Creating the auth account signs the new user in, which is what lets them
 * write their own `users/{uid}` document under the security rules. If the
 * platform requires approval, they are signed straight back out.
 */
export async function register(
  role: Extract<UserRole, 'student' | 'teacher'>,
  input: RegistrationInput
): Promise<RegistrationResult> {
  const settings = await getSettings();
  if (!settings.registrationEnabled) {
    throw new AppError('auth.registrationClosed', 'failed-precondition');
  }

  const username = normaliseUsername(input.username);
  const email = input.email.trim().toLowerCase();

  const credential = await createUserWithEmailAndPassword(auth, email, input.password);
  const uid = credential.user.uid;

  try {
    const status: UserStatus = settings.requireApproval ? 'pending' : 'active';
    const generatedId = await nextSequentialId(role === 'student' ? 'STU' : 'TCH');

    const profile: Omit<AppUser, 'id'> = {
      uid,
      fullName: input.fullName.trim(),
      username,
      email,
      mobile: input.mobile.trim(),
      role,
      status,
      country: input.country,
      language: input.language ?? DEFAULT_LANGUAGE,
      profileImage: null,
      branchId: input.branchId ?? null,
      classId: role === 'student' ? (input.classId ?? null) : null,
      classIds: role === 'teacher' ? [] : undefined,
      permissions: role === 'teacher' ? { ...DEFAULT_TEACHER_PERMISSIONS } : {},
      ...(role === 'student'
        ? {
            studentId: generatedId,
            dateOfBirth: input.dateOfBirth ?? null,
            gender: input.gender ?? null,
          }
        : {
            teacherId: generatedId,
            qualification: input.qualification ?? '',
          }),
      deleted: false,
    };

    await setDoc(doc(db, COLLECTIONS.users, uid), {
      ...profile,
      searchTokens: searchTokens(profile.fullName, username, email, generatedId),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
    });

    await claimIdentity({ username, email, uid, role });

    await sendEmailVerification(credential.user).catch(() => undefined);

    await audit.log({
      actor: { uid, fullName: profile.fullName, role },
      action: 'CREATE',
      collection: COLLECTIONS.users,
      documentId: uid,
      summary: `${profile.fullName} registered as ${role}`,
    });

    if (status !== 'active') {
      await fbSignOut(auth);
    }

    return { uid, status, generatedId, requiresApproval: status !== 'active' };
  } catch (error) {
    // The auth account exists but the profile failed — remove the orphan so the
    // person can retry with the same email address.
    await credential.user.delete().catch(() => undefined);
    throw error;
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export async function resendVerification(): Promise<void> {
  if (!auth.currentUser) throw new AppError('errors.sessionExpired', 'unauthenticated');
  await sendEmailVerification(auth.currentUser);
}

/** Re-authenticates before changing a password, as Firebase requires. */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new AppError('errors.sessionExpired', 'unauthenticated');

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export function subscribeToAuth(
  callback: (user: FirebaseUser | null) => void
): () => void {
  return onAuthStateChanged(auth, callback);
}

export function currentFirebaseUser(): FirebaseUser | null {
  return auth.currentUser;
}
