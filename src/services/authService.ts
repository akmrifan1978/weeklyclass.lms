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
  onIdTokenChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { auth, db } from '@/firebase/config';
import { COLLECTIONS, DEFAULT_LANGUAGE } from '@/constants/app';
import { AppError, denialContext } from '@/utils/errors';
import { searchTokens } from '@/utils/format';
import { isEmail } from '@/utils/validation';
import { DEFAULT_TEACHER_PERMISSIONS } from '@/types/permissions';
import type { AppUser, LanguageCode, UserRole, UserStatus } from '@/types';

import {
  authEmailForMobile,
  claimIdentity,
  emailForMobile,
  emailForUsername,
  isMobileAvailable,
  isSyntheticAuthEmail,
  nextSequentialId,
  normaliseUsername,
  usernameForEmail,
} from './identityService';
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

/**
 * Waits until Firestore will actually send the signed-in user's token.
 *
 * `signInWithEmailAndPassword` and `createUserWithEmailAndPassword` resolve as
 * soon as Firebase Auth has the credential, but the Firestore client picks the
 * token up separately, through its own auth-state listener. A request issued in
 * the gap goes out unauthenticated, so `request.auth` is null in the rules and
 * even "read your own document" is refused — a permission error that looks like
 * a broken rule and is not one.
 *
 * Forcing the ID token resolves only once that token exists, which is the
 * signal Firestore's provider is waiting on. `authStateReady` closes the same
 * gap on the SDK side where it is available.
 */
async function waitForAuthToken(user: FirebaseUser): Promise<void> {
  try {
    const ready = (auth as unknown as { authStateReady?: () => Promise<void> }).authStateReady;
    if (typeof ready === 'function') await ready.call(auth);

    // Firestore's credentials provider subscribes to onIdTokenChanged. Waiting
    // for that listener to fire for THIS user is the closest thing to a signal
    // that the token has actually reached it — `getIdToken()` alone only proves
    // Auth has one, which it does well before Firestore is told.
    await new Promise<void>((resolve) => {
      const stop = onIdTokenChanged(auth, (current) => {
        if (current?.uid !== user.uid) return;
        stop();
        clearTimeout(timer);
        resolve();
      });
      // Never hang on this. If the event has already fired we would otherwise
      // wait forever for one that is not coming again.
      const timer = setTimeout(() => {
        stop();
        resolve();
      }, 2500);
    });

    await user.getIdToken();
  } catch (error) {
    console.warn('[WeeklyClass] could not confirm the auth token before querying:', error);
  }
}

/**
 * Retries a write that was refused for lack of a token.
 *
 * Even after the wait above, the first authenticated write immediately after
 * creating an account is sometimes still refused: the request goes out before
 * Firestore has attached the credential, so the rules see `request.auth == null`
 * and refuse what is in fact a perfectly authorised write. It looks exactly like
 * a broken security rule, and no amount of rule-editing fixes it.
 *
 * A denial that is really a race disappears on a retry with a fresh token; a
 * denial that is real survives all three attempts and is then reported as it
 * always was. Costing a genuine refusal a second of delay is well worth not
 * failing a legitimate registration.
 */
async function withTokenRetry<T>(
  label: string,
  user: FirebaseUser,
  run: () => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const denied = (error as { code?: string })?.code === 'permission-denied';
      if (!denied || attempt >= 3) throw error;
      console.warn(
        `[WeeklyClass] ${label} was refused on attempt ${attempt} — ` +
          'refreshing the auth token and retrying'
      );
      await user.getIdToken(true).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

export async function fetchProfile(uid: string): Promise<AppUser | null> {
  try {
    // Read from the server, not the offline cache. The cache happily remembers
    // that this document did NOT exist — so a profile created after that point
    // (by an admin, a script, or the first-run bootstrap) stays invisible until
    // the cache expires, and sign-in keeps insisting there is no profile.
    // Falling back to the cached read keeps this working offline.
    let snap;
    try {
      snap = await getDocFromServer(doc(db, COLLECTIONS.users, uid));
    } catch {
      snap = await getDoc(doc(db, COLLECTIONS.users, uid));
    }
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as object) } as AppUser;
  } catch (error) {
    // A denied read and a missing document mean the same thing to every caller:
    // there is no profile to work with. Letting the denial propagate aborted
    // sign-in outright, which prevented the first-run bootstrap from ever
    // running — the one thing that could have fixed the situation. Report it
    // and return null so recovery can proceed.
    console.error(`[WeeklyClass] could not read users/${uid}:`, error);
    return null;
  }
}

/**
 * First-run bootstrap.
 *
 * A new project has no admin, and the security rules refuse to let anyone
 * self-register as one, so something has to break that circle. While
 * `settings/bootstrap` does not exist the platform is unconfigured, and the
 * first account to sign in successfully claims the admin role and closes the
 * window permanently.
 *
 * This replaces asking someone to hand-build a Firestore document. That proved
 * error-prone in ways that are near-impossible to diagnose afterwards: a field
 * saved as text rather than a boolean, or a document id that does not quite
 * match the uid, both surface only as an unexplained "permission denied".
 */
async function tryBootstrapFirstAdmin(user: FirebaseUser): Promise<AppUser | null> {
  // Deliberately NOT gated on reading the marker first. The security rule is
  // the authority on whether the window is open, and it is checked on the write
  // regardless. Treating a client-side read as the gate meant any hiccup — a
  // slow connection, a cold cache — silently skipped the bootstrap and left the
  // person stranded with no explanation. Attempt the write and let the rule
  // decide; a closed window simply denies it, which is the correct outcome.
  const email = (user.email ?? '').toLowerCase();
  const fullName = user.displayName || email.split('@')[0] || 'Administrator';

  console.info('[WeeklyClass] no admin exists yet — claiming first-admin for', email);

  const profile = {
    uid: user.uid,
    fullName,
    username: email.split('@')[0] ?? user.uid,
    email,
    mobile: '',
    role: 'admin' as const,
    status: 'active' as const,
    country: '',
    language: DEFAULT_LANGUAGE,
    profileImage: null,
    branchId: null,
    classId: null,
    permissions: {},
    deleted: false,
    searchTokens: searchTokens(fullName, email),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  // `merge` so this also repairs a partial profile left by a failed attempt,
  // rather than being refused as a duplicate create.
  await setDoc(doc(db, COLLECTIONS.users, user.uid), profile, { merge: true });

  // Close the window. Written after the profile, so a failure part-way through
  // leaves the bootstrap still open rather than locking everyone out forever.
  // Failing here must not undo a profile that was written successfully.
  await setDoc(doc(db, COLLECTIONS.settings, 'bootstrap'), {
    completedAt: serverTimestamp(),
    firstAdminUid: user.uid,
    firstAdminEmail: email,
  }).catch((error) => {
    console.warn('[WeeklyClass] admin profile created, but the marker failed:', error);
  });

  console.info('[WeeklyClass] first admin created; bootstrap now closed permanently');
  return { id: user.uid, ...profile } as unknown as AppUser;
}

/**
 * True when the first-run window is definitively shut.
 *
 * Deliberately returns false when the check itself fails, so an unreachable or
 * refused read never blocks the one flow that can configure a new platform.
 */
async function bootstrapIsClosed(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.settings, 'bootstrap'));
    return snap.exists();
  } catch {
    return false;
  }
}

/**
 * The same bootstrap, for an account that already has a profile — typically a
 * half-finished registration that left a pending student behind. With no admin
 * in existence there is nobody who could approve or promote it, so the first
 * sign-in claims the role and closes the window.
 */
async function promoteToFirstAdmin(profile: AppUser): Promise<AppUser | null> {
  // Same reasoning as tryBootstrapFirstAdmin: the rule is the gate, not a
  // client read that can fail for unrelated reasons.
  console.info('[WeeklyClass] attempting first-admin promotion for', profile.email);

  await updateDoc(doc(db, COLLECTIONS.users, profile.uid), {
    role: 'admin',
    status: 'active',
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, COLLECTIONS.settings, 'bootstrap'), {
    completedAt: serverTimestamp(),
    firstAdminUid: profile.uid,
    firstAdminEmail: profile.email,
  });

  console.info('[WeeklyClass] promoted to admin; bootstrap now closed permanently');
  return { ...profile, role: 'admin', status: 'active' };
}

/**
 * Resolves whatever someone typed into the address their account signs in with.
 *
 * Three things are accepted, in the order they are most likely to be right:
 *
 *   a mobile number  — the unique identity, resolved through `mobiles`
 *   a username       — resolved through `usernames`
 *   an email address — used directly, since that is what most accounts sign in
 *                      with; only if it is shared does the account sit under a
 *                      mobile-derived address instead, and `emailLookup` finds
 *                      the one that claimed the address first.
 *
 * Returns null when nothing matches, which the caller reports as bad
 * credentials — saying "no such user" would let anyone enumerate the platform.
 */
async function resolveSignInEmail(identifier: string): Promise<string | null> {
  const trimmed = identifier.trim();

  if (isEmail(trimmed)) return trimmed.toLowerCase();

  // Digits only: a phone number, however it was typed. Checked before the
  // username index because the mobile number is the identifier that is
  // guaranteed to name exactly one account.
  if (/^[+0-9\s()-]+$/.test(trimmed)) {
    const byMobile = await emailForMobile(trimmed).catch(() => null);
    if (byMobile) return byMobile;
  }

  return emailForUsername(trimmed).catch(() => null);
}

/**
 * Signs in with a mobile number, a username or an email address.
 *
 * All three are resolved to the account's sign-in address through the public
 * indexes before authenticating — see identityService for why that is safe.
 */
export async function login(identifier: string, password: string): Promise<LoginResult> {
  const trimmed = identifier.trim();
  let email = await resolveSignInEmail(trimmed);

  if (!email) {
    // Same message as a wrong password: do not reveal which accounts exist.
    throw new AppError('errors.invalidCredentials', 'auth/invalid-credential');
  }

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    // A shared email belongs to whoever registered with it first; everyone else
    // on that address signs in under a mobile-derived one. If the address itself
    // did not work, fall back to the account the email index points at before
    // giving up — otherwise the first holder's own email would stop working the
    // moment a relative reused it.
    const code = (error as { code?: string })?.code ?? '';
    const recoverable =
      isEmail(trimmed) &&
      (code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password');

    const viaIndex = recoverable
      ? await usernameForEmail(trimmed)
          .then((name) => (name ? emailForUsername(name) : null))
          .catch(() => null)
      : null;

    if (!viaIndex || viaIndex === email) throw error;
    email = viaIndex;
    credential = await signInWithEmailAndPassword(auth, email, password);
  }

  // Every Firestore call below depends on request.auth being populated.
  await waitForAuthToken(credential.user);

  let profile = await fetchProfile(credential.user.uid);

  // On an unconfigured platform the first successful sign-in becomes the
  // administrator, whether or not a partial profile already exists. A half
  // finished registration leaves a pending student behind, and with no admin
  // in existence there would be nobody able to approve or promote it.
  //
  // Once the platform IS configured this must not be attempted at all. It used
  // to run for every non-admin sign-in on the principle that the rule, not a
  // client read, is the authority — which is true, but it meant every student
  // and teacher login fired a write that was certain to be refused and logged a
  // frightening "first-admin promotion failed" over a completely normal login.
  //
  // `settings/bootstrap` is world-readable, so checking it costs one cached read
  // and is trustworthy when it succeeds. If the read itself fails we fall back
  // to the old behaviour and try anyway: a failed read must not be able to
  // strand the very first administrator, which is the whole point of the window.
  const bootstrapClosed = await bootstrapIsClosed();
  let bootstrapError: unknown = null;

  if (!profile && !bootstrapClosed) {
    profile = await tryBootstrapFirstAdmin(credential.user).catch((error) => {
      bootstrapError = error;
      console.error('[WeeklyClass] first-admin bootstrap failed:', error);
      return null;
    });
  } else if (profile && profile.role !== 'admin' && !bootstrapClosed) {
    profile = (await promoteToFirstAdmin(profile).catch((error) => {
      console.error('[WeeklyClass] first-admin promotion failed:', error);
      return null;
    })) ?? profile;
  }

  if (!profile) {
    // Authentication succeeded but users/{uid} is absent. This is the classic
    // first-time-setup mismatch: an account made in the Firebase console
    // without the matching profile document, or one created under a different
    // uid. Log the uid, because that is exactly what someone needs in order to
    // create the document with the right id.
    const reason =
      bootstrapError instanceof Error
        ? `${(bootstrapError as { code?: string }).code ?? ''} ${bootstrapError.message}`.trim()
        : String(bootstrapError ?? 'no error reported');

    console.error(
      `[WeeklyClass] Signed in as ${credential.user.email} (uid ${credential.user.uid}) ` +
        `but users/${credential.user.uid} could not be created.\n` +
        `  First-admin bootstrap outcome: ${reason}`
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

  // Self-heal the lookup indexes. An account created straight in the Firebase
  // console — which is how the very first admin has to be made — has a profile
  // but no `usernames/{username}` or `mobiles/{key}` row, so signing in by
  // username or mobile number silently fails for it. Signing in by email once
  // repairs both. `credential.user.email` is the authoritative sign-in address;
  // the profile's own `email` is only a contact detail and may be shared.
  // Fire-and-forget: it must never delay or break a successful login.
  if (profile.username) {
    void claimIdentity({
      username: profile.username,
      email: profile.email,
      authEmail: credential.user.email ?? profile.authEmail ?? profile.email,
      uid: profile.uid,
      role: profile.role,
      mobile: profile.mobile,
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

  // The mobile number is the unique identity, so check it before anything is
  // created. The transaction in claimIdentity is still the real guard against a
  // race; this exists to fail early with a message that says what is wrong,
  // rather than after an auth account has already been made.
  step('2/6 checking mobile number', input.mobile);
  if (!(await isMobileAvailable(input.mobile).catch(() => true))) {
    throw new AppError('validation.mobileTaken', 'already-exists');
  }

  // An email address may be shared — a household registering several children
  // has one inbox between them. Firebase Auth will not hold the same address
  // twice, so the second account signs in under an address derived from its own
  // (unique) mobile number instead. Nothing about the profile changes: the real
  // address is still stored and still shown, and they still sign in with their
  // mobile number or username.
  //
  // Attempting the create and reacting to the refusal is deliberate. Asking
  // Firebase up front whether an address is taken is exactly the account
  // enumeration its email-enumeration protection disables, so the answer cannot
  // be relied on — the failure itself is the only trustworthy signal.
  step('2/6 creating auth account', email);
  let authEmail = email;
  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, email, input.password);
  } catch (error) {
    if ((error as { code?: string })?.code !== 'auth/email-already-in-use') throw error;
    authEmail = authEmailForMobile(input.mobile);
    step('2/6 address already in use — signing in by mobile instead', authEmail);
    credential = await createUserWithEmailAndPassword(auth, authEmail, input.password);
  }
  const uid = credential.user.uid;
  step('2/6 auth account created', uid);

  // The counter allocation immediately below is the first authenticated write,
  // and it fails with "insufficient permissions" if Firestore has not yet
  // picked up the new user's token.
  await waitForAuthToken(credential.user);
  step('2/6 auth token ready');

  try {
    const status: UserStatus = requireApproval ? 'pending' : 'active';
    step('3/6 allocating sequential id');
    const generatedId = await withTokenRetry('counter allocation', credential.user, () =>
      nextSequentialId(role === 'student' ? 'STU' : 'TCH')
    );
    step('3/6 id allocated', generatedId);

    const profile: Omit<AppUser, 'id'> = {
      uid,
      fullName: input.fullName.trim(),
      username,
      email,
      // Kept so an admin can see at a glance which account a shared address
      // actually signs in as.
      authEmail,
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

    await withTokenRetry('profile write', credential.user, () =>
      denialContext('create', `${COLLECTIONS.users}/${uid}`, () =>
        setDoc(doc(db, COLLECTIONS.users, uid), {
          ...profile,
          searchTokens: searchTokens(profile.fullName, username, email, generatedId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: uid,
        })
      )
    );

    step('5/6 claiming username index', username);
    await withTokenRetry('identity claim', credential.user, () =>
      claimIdentity({ username, email, authEmail, uid, role, mobile: input.mobile })
    );
    step('5/6 username index claimed');

    // Everything above is essential and is awaited. These two are not: the
    // account already exists and is usable. Awaiting them added two more
    // network round-trips to a flow that already needs five, which is painfully
    // slow on a weak connection — and worse, a failure in either would trigger
    // the rollback below and destroy a perfectly good account.
    // Only worth sending to a real inbox. On a synthetic mobile-derived address
    // it would bounce, and Firebase counts it against the daily quota either way.
    if (authEmail === email) void sendEmailVerification(credential.user).catch(() => undefined);

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
    // The auth account is deliberately KEPT. It used to be deleted here so the
    // email could be reused on a retry, but that destroys a working login and
    // its password every time a later step fails — which turned one recoverable
    // error into a loop of vanishing accounts during first-run setup.
    //
    // Keeping it is recoverable in every direction: signing in completes the
    // profile through the first-run bootstrap, and an admin can finish the
    // record by hand. A deleted account and a forgotten password cannot be
    // recovered by anyone.
    console.error(
      `[WeeklyClass] The sign-in for ${email} was kept (uid ${credential.user.uid}). ` +
        `Sign in with it rather than registering again.`
    );
    throw error;
  }
}

/**
 * Sends a reset link, accepting a mobile number, username or email address.
 *
 * The link can only ever go to a real inbox. An account whose email was already
 * taken by someone else signs in under a mobile-derived address that receives no
 * mail, so there is nowhere to send it — that case is reported rather than
 * quietly reporting success, which would leave someone waiting for a message
 * that is never coming. Their administrator can set a new password for them.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const resolved = await resolveSignInEmail(identifier);

  // Nothing matched. Report success anyway — the caller shows the same message
  // either way, so confirming which accounts exist is not possible.
  if (!resolved) return;

  if (isSyntheticAuthEmail(resolved)) {
    throw new AppError('auth.resetNeedsAdmin', 'auth/no-reset-address');
  }

  await sendPasswordResetEmail(auth, resolved);
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
