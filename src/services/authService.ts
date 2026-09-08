import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updatePassword,
  verifyBeforeUpdateEmail,
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
 * denial that is real survives every attempt and is then reported as it always
 * was. Costing a genuine refusal a few seconds of delay is well worth not
 * failing a legitimate registration.
 *
 * The budget below is deliberately generous — roughly seven seconds across five
 * tries. Three tries over one second was not enough on a weak connection, which
 * is exactly where this race is most likely to be lost, and the symptom was a
 * registration refused for a permission the account definitely had.
 */
const RETRY_BACKOFF_MS = [500, 1000, 1500, 3000];

async function withTokenRetry<T>(
  label: string,
  user: FirebaseUser,
  run: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const denied = (error as { code?: string })?.code === 'permission-denied';
      if (!denied || attempt >= RETRY_BACKOFF_MS.length) throw error;
      const wait = RETRY_BACKOFF_MS[attempt];
      console.warn(
        `[WeeklyClass] ${label} was refused (attempt ${attempt + 1}) — ` +
          `refreshing the auth token and retrying in ${wait}ms`
      );
      await user.getIdToken(true).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, wait));
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

  // Both reads at once. They do not depend on each other, and run in
  // sequence they put two full round-trips between the password being accepted
  // and the dashboard appearing.
  const [fetched, bootstrapClosed] = await Promise.all([
    fetchProfile(credential.user.uid),
    bootstrapIsClosed(),
  ]);
  let profile = fetched;

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

  // Not awaited. Recording when somebody last signed in is bookkeeping, and
  // nothing on the screen depends on it — waiting for the server to confirm it
  // held the whole login open for a round-trip that bought the person nothing.
  void updateDoc(doc(db, COLLECTIONS.users, profile.uid), {
    lastLoginAt: serverTimestamp(),
  }).catch(() => undefined);

  // Self-heal the lookup indexes, but ONLY when they are actually broken.
  //
  // An account created straight in the Firebase console — which is how the very
  // first admin has to be made — has a profile but no `usernames/{username}`
  // row, so signing in by username or mobile silently fails for it. Signing in
  // by email once repairs that.
  //
  // It used to rewrite the row on every single login, which for an account
  // whose index was already correct meant a pointless write on every sign-in —
  // and when that write was refused it printed a red error over a login that
  // had worked perfectly. Reading first costs one cached lookup and skips the
  // write entirely in the normal case.
  if (profile.username) {
    void repairIdentityIndex(profile, credential.user.email).catch(() => undefined);
  }

  // Same again: the audit entry is a record of the login, not part of it, and
  // `audit.log` already swallows its own failures.
  void audit.log({
    actor: profile,
    action: 'LOGIN',
    collection: COLLECTIONS.users,
    documentId: profile.uid,
    summary: `${profile.fullName} signed in`,
  });

  return { user: profile, firebaseUser: credential.user };
}

/**
 * Rewrites `usernames/{username}` only if it is missing or points somewhere
 * else. Silent throughout: this is a repair nobody asked for, and a failed one
 * leaves the account exactly as usable as it already was.
 */
async function repairIdentityIndex(
  profile: AppUser,
  signInEmail: string | null
): Promise<void> {
  const authEmail = signInEmail ?? profile.authEmail ?? profile.email;

  const existing = await getDoc(
    doc(db, COLLECTIONS.usernames, normaliseUsername(profile.username))
  ).catch(() => null);

  const row = existing?.exists() ? existing.data() : null;
  const correct =
    row?.uid === profile.uid &&
    ((row?.authEmail as string) ?? (row?.email as string)) === authEmail;

  if (correct) return;

  await claimIdentity({
    username: profile.username,
    email: profile.email,
    authEmail,
    uid: profile.uid,
    role: profile.role,
    mobile: profile.mobile,
    quiet: true,
  });
}

/**
 * Resolves when `work` finishes or when `ms` elapses, whichever is first, and
 * never rejects. For a side effect that is worth waiting a moment for and not
 * worth waiting indefinitely for.
 */
function atMost<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** How long logout will wait for the audit entry before going anyway. */
const LOGOUT_AUDIT_BUDGET_MS = 1200;

export async function logout(actor?: AppUser | null): Promise<void> {
  if (actor) {
    // Bounded, not awaited outright. The entry has to be written while the
    // person is still signed in — the rules require it — so it cannot simply be
    // fired afterwards. But waiting for the server to confirm it is what made
    // signing out on a weak connection look like the app had frozen: a write
    // that never came back held the whole thing open with nothing on screen to
    // explain why. It gets a moment; then logout proceeds regardless.
    await atMost(
      audit.log({
        actor,
        action: 'LOGOUT',
        collection: COLLECTIONS.users,
        documentId: actor.uid,
        summary: `${actor.fullName} signed out`,
      }),
      LOGOUT_AUDIT_BUDGET_MS
    );
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

  // No address given at all. Plenty of teachers and older students simply do
  // not have one, and demanding it was turning a contact detail into a barrier
  // to having an account. The mobile-derived address already exists for the
  // case where an address is taken, and serves exactly as well here.
  //
  // The cost is stated rather than hidden: an account with no real inbox cannot
  // be sent a password reset, which is what the recovery flow and the profile's
  // sign-in section are for.
  const signInAddress = email || authEmailForMobile(input.mobile);

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
  step('2/6 creating auth account', signInAddress);
  let authEmail = signInAddress;
  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, signInAddress, input.password);
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

  // The requirement is satisfied the moment a new password is actually set,
  // and only then — clearing it before updatePassword resolves would let a
  // failed change count as a done one. Not awaited: the password has changed
  // whether or not the flag write lands, and holding the screen open for it
  // would be waiting on bookkeeping.
  void updateDoc(doc(db, COLLECTIONS.users, user.uid), {
    mustChangePassword: false,
  }).catch(() => undefined);
}

/**
 * Points the account at a real inbox, so its owner can recover it.
 *
 * An account whose sign-in address ends `@mobile.weeklyclass.app` has nowhere
 * to receive a reset link — the address does not exist. That happens when the
 * person's own email was already registered to somebody else, usually a
 * relative, and it leaves them dependent on an admin forever. This is the way
 * out of that, and it is the only one available without a server.
 *
 * `verifyBeforeUpdateEmail` rather than `updateEmail`: the change takes effect
 * only when the link in the NEW inbox is clicked, so a typo cannot lock someone
 * out of an account they are currently standing in.
 *
 * Nothing is written to Firestore here. Until that link is clicked the account
 * still signs in at the old address, and the indexes must keep saying so; once
 * it is clicked, the repair on the next sign-in rewrites them from the live
 * value. Updating them now would break sign-in during the gap, and permanently
 * if the link were never opened.
 */
export async function changeSignInEmail(
  currentPassword: string,
  newEmail: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new AppError('errors.sessionExpired', 'unauthenticated');

  const address = newEmail.trim().toLowerCase();
  if (!isEmail(address)) throw new AppError('validation.emailInvalid', 'invalid-argument');
  if (address === user.email.toLowerCase()) {
    throw new AppError('auth.sameEmail', 'invalid-argument');
  }
  if (isSyntheticAuthEmail(address)) {
    throw new AppError('validation.emailInvalid', 'invalid-argument');
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await verifyBeforeUpdateEmail(user, address);
}

export function subscribeToAuth(
  callback: (user: FirebaseUser | null) => void
): () => void {
  return onAuthStateChanged(auth, callback);
}

export function currentFirebaseUser(): FirebaseUser | null {
  return auth.currentUser;
}
