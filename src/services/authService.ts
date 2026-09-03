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
    // Authentication succeeded but users/{uid} is absent. This is the classic
    // first-time-setup mismatch: an account made in the Firebase console
    // without the matching profile document, or one created under a different
    // uid. Log the uid, because that is exactly what someone needs in order to
    // create the document with the right id.
    console.error(
      `[WeeklyClass] Signed in as ${credential.user.email} (uid ${credential.user.uid}) ` +
        `but users/${credential.user.uid} does not exist. Create that document ` +
        `with the document ID set to this uid.`
    );
    await fbSignOut(auth);
    throw new AppError('auth.profileMissing', 'auth/profile-missing');
  }

  // The exact shape of this document decides what the security rules allow, and
  // a mismatch between what it looks like in the console and what the rules see
  // is the hardest first-run problem to diagnose. Log the fields that matter.
  console.info('[WeeklyClass] profile loaded:', {
    docId: profile.id,
    uid: profile.uid,
    uidMatchesDocId: profile.uid === profile.id,
    uidMatchesAuth: profile.uid === credential.user.uid,
    role: profile.role,
    roleType: typeof profile.role,
    status: profile.status,
    statusType: typeof profile.status,
    deleted: profile.deleted,
    deletedType: typeof profile.deleted,
  });

  if (profile.status !== 'active') {
    await fbSignOut(auth);
    throw new AppError(LOGIN_BLOCKED[profile.status], 'auth/user-disabled');
  }

  await updateDoc(doc(db, COLLECTIONS.users, profile.uid), {
    lastLoginAt: serverTimestamp(),
  }).catch(() => undefined);

  // Self-heal the username index. An account created straight in the Firebase
  // console — which is how the very first admin has to be made — has a profile
  // but no `usernames/{username}` row, so signing in by username or mobile
  // number silently fails for it. Signing in by email once repairs that.
  // Fire-and-forget: it must never delay or break a successful login.
  if (profile.username) {
    void claimIdentity({
      username: profile.username,
      email: profile.email,
      uid: profile.uid,
      role: profile.role,
    }).catch(() => undefined);
  }

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
/**
 * Registration is a chain of remote calls, any of which can fail or stall on a
 * weak connection. Logging each step turns "it did not work" into a precise
 * location, which is otherwise very hard to recover after the fact.
 */
function step(name: string, detail?: unknown): void {
  if (detail === undefined) console.info(`[WeeklyClass] register: ${name}`);
  else console.info(`[WeeklyClass] register: ${name}`, detail);
}

export async function register(
  role: Extract<UserRole, 'student' | 'teacher'>,
  input: RegistrationInput
): Promise<RegistrationResult> {
  // One more round-trip before anything happens. getSettings already falls back
  // to safe defaults, so cap the wait rather than let a slow network stall the
  // form before it has even started.
  const settings = await Promise.race([
    getSettings(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
  ]);

  if (settings && !settings.registrationEnabled) {
    throw new AppError('auth.registrationClosed', 'failed-precondition');
  }
  const requireApproval = settings?.requireApproval ?? true;

  step('1/6 settings read ok', { requireApproval });

  const username = normaliseUsername(input.username);
  const email = input.email.trim().toLowerCase();

  step('2/6 creating auth account', email);
  const credential = await createUserWithEmailAndPassword(auth, email, input.password);
  const uid = credential.user.uid;
  step('2/6 auth account created', uid);

  try {
    const status: UserStatus = requireApproval ? 'pending' : 'active';
    step('3/6 allocating sequential id');
    const generatedId = await nextSequentialId(role === 'student' ? 'STU' : 'TCH');
    step('3/6 id allocated', generatedId);

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
      // Only teachers carry a class list; omit the key entirely for students
      // rather than writing undefined.
      ...(role === 'teacher' ? { classIds: [] as string[] } : {}),
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
      // Recorded so there is proof of what was agreed, and when.
      declarationAcceptedAt: new Date(),
    };

    step('4/6 writing profile document', `users/${uid}`);
    // A profile may already exist if this uid was set up by hand in the Firebase
    // console. The security rules treat an overwrite as an UPDATE, and the
    // update rule forbids touching `role`, so the write would fail with a bare
    // "insufficient permissions". Say what actually happened instead.
    const existingProfile = await getDoc(doc(db, COLLECTIONS.users, uid));
    if (existingProfile.exists()) {
      throw new AppError('auth.profileAlreadyExists', 'already-exists');
    }

    await setDoc(doc(db, COLLECTIONS.users, uid), {
      ...profile,
      searchTokens: searchTokens(profile.fullName, username, email, generatedId),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
    });

    step('5/6 claiming username index', username);
    await claimIdentity({ username, email, uid, role, mobile: input.mobile });
    step('5/6 username index claimed');

    // Everything above is essential and is awaited. These two are not: the
    // account already exists and is usable. Awaiting them added two more
    // network round-trips to a flow that already needs five, which is painfully
    // slow on a weak connection — and worse, a failure in either would trigger
    // the rollback below and destroy a perfectly good account.
    void sendEmailVerification(credential.user).catch(() => undefined);

    void audit.log({
      actor: { uid, fullName: profile.fullName, role },
      action: 'CREATE',
      collection: COLLECTIONS.users,
      documentId: uid,
      summary: `${profile.fullName} registered as ${role}`,
    });

    if (status !== 'active') {
      await fbSignOut(auth);
    }

    step('6/6 complete', { generatedId, status });
    return { uid, status, generatedId, requiresApproval: status !== 'active' };
  } catch (error) {
    console.error('[WeeklyClass] register FAILED at the step logged above:', error);
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
