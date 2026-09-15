import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { accountSearchTokens, searchTokens } from '@/utils/format';
import { cleanDial, toE164 } from '@/utils/phone';
import { isEmail } from '@/utils/validation';
import { DEFAULT_TEACHER_PERMISSIONS } from '@/types/permissions';
import type { AppUser, ClassRoom, LanguageCode, UserRole, UserStatus } from '@/types';

import {
  altAuthEmailForMobile,
  authEmailForMobile,
  claimIdentity,
  emailForMobile,
  MOBILES,
  normaliseMobile,
  emailForUsername,
  isMobileAvailable,
  isSyntheticAuthEmail,
  isUsernameAvailable,
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

/*
 * Registration is in progress — hold the door.
 *
 * For the few seconds it takes, `users/{uid}` passes through states that look
 * exactly like a dead account to anything watching it: absent at first, then
 * present but `pending` when the centre requires approval. The session watcher
 * in AuthContext reacts to a non-active profile by signing the person out,
 * which is right for an account an admin has just suspended and catastrophic
 * for one that is being created — the remaining writes lose their credentials
 * mid-flight and are refused.
 *
 * That is what "Refused: claim usernames/... + mobiles/..." was. The profile
 * write and the identity claim run together; the profile landed first, the
 * watcher saw `pending` and signed out, and the claim — a transaction, so
 * slower — committed with no auth at all. Every retry then refreshed a token
 * for somebody who was no longer signed in. Being a race, it struck some
 * registrations and not others, and it left behind an auth account with no
 * profile and no index rows, which is precisely the wreckage found in this
 * project.
 *
 * A counter rather than a boolean so that two registrations on one device
 * cannot have the first to finish lift the guard for the second.
 *
 * register() signs a pending account out itself when it is done, so nothing is
 * lost by deferring — only the moment it happens changes.
 */
let registrationsInFlight = 0;

export function isRegistering(): boolean {
  return registrationsInFlight > 0;
}

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
/**
 * Remembered on the device, because the answer is one-way.
 *
 * The first-run window shuts once and can never reopen — creating the first
 * admin writes `settings/bootstrap` and nothing deletes it. So once this has
 * been true it is true for ever, and asking again is a round trip spent
 * confirming something already known.
 *
 * That matters more here than it looks. Measured against this project, a single
 * Firestore read costs between half a second and three, because the database
 * sits in Mumbai and the people using it are in Jeddah. Removing one read from
 * every sign-in removes real seconds from it, not milliseconds.
 *
 * Only the TRUE answer is cached. A false one means the platform may still be
 * unconfigured, and getting that wrong would strand the very first
 * administrator — so it is re-checked every time until it goes true.
 */
const BOOTSTRAP_CLOSED_KEY = '@weeklyclass/bootstrap-closed';

async function bootstrapIsClosed(): Promise<boolean> {
  const remembered = await AsyncStorage.getItem(BOOTSTRAP_CLOSED_KEY).catch(() => null);
  if (remembered === 'yes') return true;

  try {
    const snap = await getDoc(doc(db, COLLECTIONS.settings, 'bootstrap'));
    if (snap.exists()) {
      void AsyncStorage.setItem(BOOTSTRAP_CLOSED_KEY, 'yes').catch(() => undefined);
      return true;
    }
    return false;
  } catch {
    // Deliberately false when the check itself fails, so an unreachable or
    // refused read never blocks the one flow that can configure a new platform.
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
async function resolveSignInEmail(
  identifier: string,
  dial?: string | null
): Promise<string | null> {
  const trimmed = identifier.trim();

  if (isEmail(trimmed)) return trimmed.toLowerCase();

  // Digits only: a phone number, however it was typed. Checked before the
  // username index because the mobile number is the identifier that is
  // guaranteed to name exactly one account.
  if (/^[+0-9\s()-]+$/.test(trimmed)) {
    const byMobile = await emailForMobile(trimmed, dial).catch(() => null);
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
/**
 * Where a sign-in spent its time.
 *
 * Slow logins have been reported repeatedly and the path has been shortened
 * twice, but nobody has ever been able to say WHICH part was slow — the report
 * arrives as "it hangs" and the developer cannot reproduce it on a fast
 * connection in a different country. This prints a breakdown on every sign-in,
 * so the next report can carry numbers instead of an impression.
 *
 * Cheap enough to leave on: four calls to Date.now and one console line, on an
 * action that happens once a session.
 */
function phaseTimer() {
  const start = Date.now();
  let last = start;
  const marks: string[] = [];
  return {
    mark(name: string) {
      const now = Date.now();
      marks.push(`${name} ${now - last}ms`);
      last = now;
    },
    done() {
      console.info(
        `[WeeklyClass] sign-in took ${Date.now() - start}ms — ${marks.join(', ')}`
      );
    },
  };
}

export async function login(
  identifier: string,
  password: string,
  /** The country code beside the box, when what was typed is a number. */
  dial?: string | null
): Promise<LoginResult> {
  const timing = phaseTimer();
  const trimmed = identifier.trim();
  let email = await resolveSignInEmail(trimmed, dial);
  timing.mark('resolve address');

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

  timing.mark('password check');

  // Every Firestore call below depends on request.auth being populated.
  await waitForAuthToken(credential.user);
  timing.mark('token ready');

  // Both reads at once. They do not depend on each other, and run in
  // sequence they put two full round-trips between the password being accepted
  // and the dashboard appearing.
  const [fetched, bootstrapClosed] = await Promise.all([
    fetchProfile(credential.user.uid),
    bootstrapIsClosed(),
  ]);
  timing.mark('profile');
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

  timing.done();
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

  const mobileKey = profile.mobile
    ? normaliseMobile(profile.mobile, profile.mobileCountryCode)
    : '';
  const [existing, existingMobile] = await Promise.all([
    getDoc(doc(db, COLLECTIONS.usernames, normaliseUsername(profile.username))).catch(() => null),
    mobileKey ? getDoc(doc(db, MOBILES, mobileKey)).catch(() => null) : Promise.resolve(null),
  ]);

  const row = existing?.exists() ? existing.data() : null;
  const numberRow = existingMobile?.exists() ? existingMobile.data() : null;
  const usernameCorrect =
    row?.uid === profile.uid &&
    ((row?.authEmail as string) ?? (row?.email as string)) === authEmail;
  // The number's row carries the username too, which "forgot username" reads.
  const numberCorrect =
    !mobileKey ||
    (numberRow?.uid === profile.uid &&
      numberRow?.username === normaliseUsername(profile.username));
  // A number held by a DIFFERENT account is not this repair's to take. The
  // username is still put right; the clash is for an admin to settle.
  const numberHeldElsewhere = Boolean(numberRow && numberRow.uid !== profile.uid);

  if (usernameCorrect && (numberCorrect || numberHeldElsewhere)) return;

  await claimIdentity({
    username: profile.username,
    email: profile.email,
    authEmail,
    uid: profile.uid,
    role: profile.role,
    mobile: numberHeldElsewhere ? undefined : profile.mobile,
    mobileCountryCode: profile.mobileCountryCode,
    quiet: true,
  });
}

export async function logout(actor?: AppUser | null): Promise<void> {
  if (actor) {
    /*
     * Started, not waited for.
     *
     * This used to give the audit write up to 1200ms to come back before
     * signing out. Measured against this project a single write costs between
     * half a second and a second and a half, so that budget was not a safety
     * valve — it was spent in full nearly every time, and it was the whole of
     * why signing out felt slow. Sign-out itself takes about a millisecond.
     *
     * The write is issued first so it carries a valid token, and the SDK sends
     * it from its own queue. On a slow connection some entries will be lost to
     * the sign-out that follows, and that is the trade being made deliberately:
     * a record that somebody left is worth less than every person who leaves
     * waiting a second and a half to find out they have.
     *
     * Logins are unaffected and still recorded, so sessions remain traceable.
     */
    void audit.log({
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
  /** "+966". Chosen beside the number; the number keeps its leading zero. */
  mobileCountryCode?: string | null;
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
  // One at a time. A second tap on Register while the first was still working
  // started a second registration for the same person in parallel - both on
  // the same new sign-in, each writing its own username row, which is one way
  // a profile can end up with a username that sign-in does not know.
  if (registrationsInFlight > 0) {
    throw new AppError('auth.registrationInProgress', 'failed-precondition');
  }
  registrationsInFlight += 1;
  try {
    return await runRegistration(role, input);
  } finally {
    registrationsInFlight -= 1;
  }
}

async function runRegistration(
  role: Extract<UserRole, 'student' | 'teacher'>,
  input: RegistrationInput
): Promise<RegistrationResult> {
  /*
   * Both reads at once, because neither needs the other.
   *
   * They were sequential, which on a database in another country is a second
   * of waiting for no reason — the settings say whether registration is open,
   * the mobile check says whether this number is free, and neither answer
   * changes the other's question. Started together, the pair costs one
   * round-trip instead of two.
   *
   * The settings wait is still capped: getSettings falls back to safe defaults,
   * so a slow network should not stall a form before it has started.
   */
  const settingsPromise = Promise.race([
    getSettings(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
  ]);
  // The mobile number is the unique identity. The transaction in claimIdentity
  // is still the real guard against a race; this exists to fail early with a
  // message that says what is wrong, rather than after an auth account has
  // already been made.
  const mobileFreePromise = isMobileAvailable(input.mobile, input.mobileCountryCode).catch(
    () => true
  );
  // And the username, in the same breath. The transaction in claimIdentity is
  // still what actually enforces it; this only means somebody is told which
  // field is wrong BEFORE an account is created, rather than after.
  const username = normaliseUsername(input.username);
  const usernameFreePromise = isUsernameAvailable(username).catch(() => true);

  /*
   * The teachers who come with the chosen group, fetched in the same breath.
   *
   * A student does not pick a teacher — the group they join decides who
   * teaches them — so allocating one by hand afterwards was admin work that
   * never needed a person. It happens here instead, at the moment the group
   * is chosen.
   *
   * Read from the class rather than taken from the sign-up form. The form
   * already holds the class document and could hand the names over for free,
   * but then the allocation on a student's record would be whatever their
   * device claimed it was, which is not something to take on trust. The read
   * goes out with the other two checks and has landed long before the profile
   * is written, so being authoritative here costs no waiting.
   *
   * A failure is deliberately swallowed. Not knowing the teachers is a gap an
   * admin can fill in a moment; refusing the registration over it is not.
   */
  const classPromise =
    role === 'student' && input.classId
      ? getDoc(doc(db, COLLECTIONS.classes, input.classId)).catch(() => null)
      : Promise.resolve(null);

  const settings = await settingsPromise;

  if (settings && !settings.registrationEnabled) {
    throw new AppError('auth.registrationClosed', 'failed-precondition');
  }
  const requireApproval = settings?.requireApproval ?? true;

  step('1/6 settings read ok', { requireApproval });

  const email = input.email.trim().toLowerCase();

  // No address given at all. Plenty of teachers and older students simply do
  // not have one, and demanding it was turning a contact detail into a barrier
  // to having an account. The mobile-derived address already exists for the
  // case where an address is taken, and serves exactly as well here.
  //
  // The cost is stated rather than hidden: an account with no real inbox cannot
  // be sent a password reset, which is what the recovery flow and the profile's
  // sign-in section are for.
  const signInAddress = email || authEmailForMobile(input.mobile, input.mobileCountryCode);

  // The mobile number is the unique identity, so check it before anything is
  // created. The transaction in claimIdentity is still the real guard against a
  // race; this exists to fail early with a message that says what is wrong,
  // rather than after an auth account has already been made.
  step('2/6 checking mobile number and username', input.mobile);
  if (!(await mobileFreePromise)) {
    throw new AppError('validation.mobileTaken', 'already-exists');
  }
  if (!(await usernameFreePromise)) {
    throw new AppError('validation.usernameTaken', 'already-exists');
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

    // A household shares one inbox, so the address may already belong to a
    // sibling. This account signs in under an address derived from its own
    // (unique) mobile number instead.
    authEmail = authEmailForMobile(input.mobile, input.mobileCountryCode);
    step('2/6 address already in use — signing in by mobile instead', authEmail);

    try {
      credential = await createUserWithEmailAndPassword(auth, authEmail, input.password);
    } catch (second) {
      if ((second as { code?: string })?.code !== 'auth/email-already-in-use') throw second;

      /*
       * BOTH addresses are taken, and the mobile-derived one can only belong to
       * this very person — it is derived from the number they just gave, and
       * the number was checked as free a moment ago.
       *
       * So this is an account a PREVIOUS attempt created and then failed to
       * finish: a sign-in exists, no profile was ever written, and the index
       * row that would have said "this number is taken" was never written
       * either.
       *
       * There are two ways through, and both are taken in turn.
       */

      /*
       * RESUME, if we can prove the unfinished account is theirs.
       *
       * Signing in to it gives back the same uid, and the rest of registration
       * then writes the profile and the index that were missing. The half-made
       * account becomes the finished one, and no debris is left behind. This
       * is the better outcome and is why it is tried first.
       */
      step('2/6 an unfinished account exists for this number — trying to resume it');
      try {
        const resumed = await signInWithEmailAndPassword(auth, authEmail, input.password);
        /*
         * Only an account with NO profile is unfinished. One that has a profile -
         * a removed account whose number was given back, say - is finished
         * business: writing over it is refused by the rules, and would not be
         * right if it were not. That case starts again under a new address.
         */
        await waitForAuthToken(resumed.user);
        const existingProfile = await getDoc(doc(db, COLLECTIONS.users, resumed.user.uid)).catch(
          () => null
        );
        if (existingProfile?.exists()) {
          await fbSignOut(auth).catch(() => undefined);
          throw new Error('the sign-in for this number already belongs to an account');
        }
        credential = resumed;
        step('2/6 resumed the unfinished account');
      } catch {
        /*
         * START AGAIN, when we cannot.
         *
         * The password does not match, so this cannot be proven to be the same
         * person, and adopting the account on a guess would be a way to attach
         * yourself to somebody else's sign-in by claiming their phone number.
         *
         * But refusing outright was worse, and it is what people kept hitting:
         * "an unfinished account already exists for this mobile number", every
         * single attempt, with no way past it. The dead account owns nothing —
         * no profile, no index row, nothing anybody can sign in to or recover —
         * yet it held the number hostage because it happened to own an address
         * derived from it.
         *
         * So the address is sidestepped rather than fought over. A fresh
         * account is created under a different synthetic address for the same
         * number, and registration carries on normally.
         *
         * THE NUMBER IS STILL UNIQUE. Uniqueness lives in `mobiles/{key}` and
         * the transaction that claims it, never in the shape of a sign-in
         * address — and a COMPLETED account holds that row, so its number was
         * already reported as taken long before this point. Only an unfinished
         * one can reach here, and an unfinished one owns nothing to protect.
         */
        step('2/6 could not resume it — registering under a new address instead');

        let made = null as typeof credential | null;
        // Six random characters; a collision would need the same six twice.
        // Tried a few times regardless, because the cost of being wrong here
        // is somebody being turned away again.
        for (let attempt = 0; attempt < 3 && !made; attempt += 1) {
          const fresh = altAuthEmailForMobile(input.mobile, input.mobileCountryCode);
          try {
            made = await createUserWithEmailAndPassword(auth, fresh, input.password);
            authEmail = fresh;
          } catch (third) {
            if ((third as { code?: string })?.code !== 'auth/email-already-in-use') throw third;
          }
        }
        if (!made) throw new AppError('auth.mobileHasUnfinishedAccount', 'already-exists');
        credential = made;
      }
    }
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

    /*
     * A refused counter no longer costs somebody their registration.
     *
     * The id is a CONVENIENCE — a human-readable STU-2026-0013 to quote on a
     * form — and the account works perfectly without a pretty one. Yet this
     * was the step most likely to fail, and when it failed the whole
     * registration was abandoned: no profile, no username, and a sign-in left
     * behind that made every retry fail differently. People were being turned
     * away at the door over a serial number.
     *
     * Every check is still made and the counter is still the preferred source,
     * with the retry that refreshes the token behind it. Only the CONSEQUENCE
     * of failing has changed.
     *
     * The fallback is derived from the uid, which is itself unique, and it
     * deliberately does not pretend to be sequential — an admin looking at
     * STU-2026-H7H5K2 can see at a glance that it was not issued by the
     * counter, and can renumber it if the order matters to them.
     */
    const prefix = role === 'student' ? 'STU' : 'TCH';
    let generatedId: string;
    try {
      /*
       * Capped at eight seconds.
       *
       * Under a crush of simultaneous registrations the counter retries with
       * growing backoff, and measured against the live project the slowest of
       * thirty waited nearly a minute for its number. Nobody should stare at a
       * spinner that long for a serial number. Past the cap, the fallback id
       * below is issued and registration carries straight on.
       *
       * Safe: if the abandoned attempt commits later, the counter simply skips
       * a value. A gap in the numbering, never the same number twice.
       */
      generatedId = await Promise.race([
        withTokenRetry('counter allocation', credential.user, () => nextSequentialId(prefix)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('counter allocation took too long')), 8000)
        ),
      ]);
      step('3/6 id allocated', generatedId);
    } catch (error) {
      generatedId = `${prefix}-${new Date().getFullYear()}-${uid.slice(0, 6).toUpperCase()}`;
      console.warn(
        `[WeeklyClass] the id counter was refused, so ${generatedId} was issued instead. ` +
          'The account is complete; only the number is out of sequence.',
        error
      );
      step('3/6 counter refused — issued a non-sequential id', generatedId);
    }

    /*
     * Resolved, not awaited — the read above finished during the auth account
     * creation, so this is already sitting there.
     */
    const classSnap = await classPromise;
    const classData = classSnap?.exists() ? (classSnap.data() as Partial<ClassRoom>) : null;
    const allocatedTeachers = {
      assignedTeacherIds: classData?.teacherIds ?? [],
      assignedTeacherNames: classData?.teacherNames ?? [],
    };
    if (role === 'student') {
      step('3/6 teachers allocated from the class group', allocatedTeachers.assignedTeacherNames);
    }

    const profile: Omit<AppUser, 'id'> = {
      uid,
      fullName: input.fullName.trim(),
      username,
      email,
      // Kept so an admin can see at a glance which account a shared address
      // actually signs in as.
      authEmail,
      mobile: input.mobile.trim(),
      mobileCountryCode: cleanDial(input.mobileCountryCode),
      mobileE164: toE164(input.mobile, input.mobileCountryCode),
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
            ...allocatedTeachers,
          }
        : {
            teacherId: generatedId,
            qualification: input.qualification ?? '',
          }),
      deleted: false,
      // Recorded so there is proof of what was agreed, and when.
      declarationAcceptedAt: new Date(),
    };

    step('4/6 writing profile and claiming username');

    /*
     * The profile write and the username claim run TOGETHER.
     *
     * They were one after the other, and neither needs the other's result: the
     * claim writes `usernames/{username}`, the profile writes `users/{uid}`.
     * Sequential, that is two crossings of the network for work that could
     * have gone at once.
     *
     * The failure behaviour is unchanged. Sequentially, a failed claim already
     * left the profile written, because the profile went first — so running
     * them side by side ends in exactly the same state, reached sooner. Either
     * rejection still lands in the catch below, which keeps the auth account.
     */
    const writeProfile = withTokenRetry('profile write', credential.user, () =>
      denialContext('create', `${COLLECTIONS.users}/${uid}`, () =>
        setDoc(doc(db, COLLECTIONS.users, uid), {
          ...profile,
          searchTokens: accountSearchTokens(profile),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: uid,
        })
      )
    ).catch(async (error) => {
      /*
       * A profile may already exist if this uid was set up by hand in the
       * Firebase console. The rules treat an overwrite as an UPDATE, and the
       * update rule forbids touching `role`, so the write fails with a bare
       * "insufficient permissions".
       *
       * That check used to run BEFORE every write — one guaranteed round-trip
       * on every registration to explain a case that almost never happens. It
       * now runs only when the write has actually failed, where the cost is
       * paid by the rare failure rather than by everybody.
       */
      const existing = await getDoc(doc(db, COLLECTIONS.users, uid)).catch(() => null);
      if (existing?.exists()) {
        throw new AppError('auth.profileAlreadyExists', 'already-exists');
      }
      throw error;
    });

    const claim = withTokenRetry('identity claim', credential.user, () =>
      claimIdentity({
        username,
        email,
        authEmail,
        uid,
        role,
        mobile: input.mobile,
        mobileCountryCode: input.mobileCountryCode,
      })
    );

    await Promise.all([writeProfile, claim]);
    step('5/6 profile written and username claimed');

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
export async function requestPasswordReset(
  identifier: string,
  /** The country code beside the box, when what was typed is a number. */
  dial?: string | null
): Promise<void> {
  const resolved = await resolveSignInEmail(identifier, dial);

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
