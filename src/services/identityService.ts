import * as Crypto from 'expo-crypto';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { AppError, denialContext } from '@/utils/errors';
import type { UserRole } from '@/types';

/**
 * Username, mobile and email lookup.
 *
 * Signing in with a username or a mobile number means resolving it to the
 * account's Firebase Auth address *before* authenticating, so three tiny public
 * indexes exist:
 *
 *   usernames/{usernameLower}   -> { uid, authEmail, email, role }
 *   mobiles/{mobileKey}         -> { uid, username, authEmail }
 *   emailLookup/{sha256(email)} -> { username }
 *
 * Security rules allow `get` on these but NOT `list`, so a caller must already
 * know the exact username (or email) to read a row — the collections cannot be
 * enumerated. Email addresses are hashed into the document id so the index
 * never exposes an address to someone who does not already have it.
 *
 * THE UNIQUE KEY IS THE MOBILE NUMBER, NOT THE EMAIL. A household shares one
 * address, so several students legitimately register with the same one; Firebase
 * Auth, however, refuses a second account on an address it already holds. Where
 * that happens the account signs in under a synthetic address derived from the
 * phone number instead — see `authEmailForMobile` — and the real address is kept
 * on the profile purely as a contact detail. `mobiles` is what actually enforces
 * one-person-one-account.
 */

export const EMAIL_LOOKUP = 'emailLookup';

export async function hashEmail(email: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    email.trim().toLowerCase()
  );
}

export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Reduces a typed mobile number to a comparable key: digits only, with any
 * leading zeros or country code stripped to the last 9 digits. "+94 77 123 4567",
 * "0771234567" and "771234567" all collapse to the same key, so the same phone
 * cannot register twice just by being typed differently.
 */
export function normaliseMobile(mobile: string): string {
  const digits = mobile.replace(/[^0-9]/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
}

export const MOBILES = 'mobiles';

/**
 * The domain used for synthetic sign-in addresses. It is never sent mail — it
 * exists only because Firebase Auth insists on an email-shaped credential and
 * insists that it be unique, and the mobile number is the thing that is
 * genuinely unique here.
 */
const AUTH_EMAIL_DOMAIN =
  process.env.EXPO_PUBLIC_AUTH_EMAIL_DOMAIN ?? 'mobile.weeklyclass.app';

/**
 * The fallback sign-in address for a phone number: `771234567@mobile.…`.
 *
 * Used only when the person's real email is already attached to another
 * account. They still sign in with their mobile number or username, which is
 * resolved through the indexes above, so this address never has to be typed or
 * even seen.
 */
export function authEmailForMobile(mobile: string): string {
  return `${normaliseMobile(mobile)}@${AUTH_EMAIL_DOMAIN}`;
}

/** True when this is one of the synthetic addresses above, not a real inbox. */
export function isSyntheticAuthEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(`@${AUTH_EMAIL_DOMAIN}`));
}

/** True when no account has claimed this phone number yet. */
export async function isMobileAvailable(mobile: string): Promise<boolean> {
  const key = normaliseMobile(mobile);
  if (!key) return true;
  const snap = await getDoc(doc(db, MOBILES, key));
  return !snap.exists();
}

/**
 * Resolves a username to the address the account actually signs in with.
 *
 * `authEmail` and `email` differ only for an account that had to fall back to a
 * synthetic address. Rows written before that existed carry `email` alone, so it
 * remains the fallback and those logins keep working untouched.
 */
export async function emailForUsername(username: string): Promise<string | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.usernames, normaliseUsername(username)));
  if (!snap.exists()) return null;
  const data = snap.data();
  return (data.authEmail as string) ?? (data.email as string) ?? null;
}

/**
 * Resolves a typed mobile number to its sign-in address. This is the primary
 * path: the mobile number is the one identifier guaranteed to name exactly one
 * account, and it is what people here expect to sign in with.
 */
export async function emailForMobile(mobile: string): Promise<string | null> {
  const key = normaliseMobile(mobile);
  if (!key) return null;
  const snap = await getDoc(doc(db, MOBILES, key));
  if (!snap.exists()) return null;
  const data = snap.data();
  return (data.authEmail as string) ?? (data.email as string) ?? null;
}

/** Resolves a mobile number to its username — powers "forgot username". */
export async function usernameForMobile(mobile: string): Promise<string | null> {
  const key = normaliseMobile(mobile);
  if (!key) return null;
  const snap = await getDoc(doc(db, MOBILES, key));
  return snap.exists() ? ((snap.data().username as string) ?? null) : null;
}

/** Resolves an email address to its username — powers "forgot username". */
export async function usernameForEmail(email: string): Promise<string | null> {
  const snap = await getDoc(doc(db, EMAIL_LOOKUP, await hashEmail(email)));
  return snap.exists() ? ((snap.data().username as string) ?? null) : null;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const snap = await getDoc(doc(db, COLLECTIONS.usernames, normaliseUsername(username)));
  return !snap.exists();
}

/**
 * Claims a username and a mobile number for a uid. Both run in one transaction
 * so two people registering at the same moment cannot both succeed.
 *
 * `authEmail` is what the account signs in with; `email` is the contact address
 * shown on the profile. They are usually the same, and deliberately are not
 * required to be — see the note at the top of this file.
 */
export async function claimIdentity(params: {
  username: string;
  email: string;
  /** Defaults to `email`, for accounts that kept their address as the login. */
  authEmail?: string;
  uid: string;
  role: UserRole;
  mobile?: string;
  /**
   * Suppresses the "DENIED" console error on refusal.
   *
   * For the optional repair on sign-in, where a failure changes nothing and is
   * already swallowed by the caller. Shouting about it put a red error in front
   * of an admin whose login had in fact worked perfectly.
   */
  quiet?: boolean;
}): Promise<void> {
  const username = normaliseUsername(params.username);
  const email = params.email.trim().toLowerCase();
  const authEmail = (params.authEmail ?? email).trim().toLowerCase();
  const mobileKey = params.mobile ? normaliseMobile(params.mobile) : '';

  // Names only what is actually written. The label used to read "mobiles/" with
  // nothing after it for an account with no mobile number, which pointed at a
  // write that was never attempted.
  const target = mobileKey
    ? `usernames/${username} + mobiles/${mobileKey}`
    : `usernames/${username}`;

  const withContext = <T,>(run: () => Promise<T>) =>
    params.quiet ? run() : denialContext('claim', target, run);

  await withContext(() =>
   runTransaction(db, async (tx) => {
    const usernameRef = doc(db, COLLECTIONS.usernames, username);
    const existing = await tx.get(usernameRef);
    if (existing.exists() && existing.data().uid !== params.uid) {
      throw new AppError('validation.usernameTaken', 'already-exists');
    }

    // One phone number, one account — read before any write, as a Firestore
    // transaction requires.
    const mobileRef = mobileKey ? doc(db, MOBILES, mobileKey) : null;
    if (mobileRef) {
      const existingMobile = await tx.get(mobileRef);
      if (existingMobile.exists() && existingMobile.data().uid !== params.uid) {
        throw new AppError('validation.mobileTaken', 'already-exists');
      }
    }

    tx.set(usernameRef, {
      uid: params.uid,
      email,
      authEmail,
      role: params.role,
      createdAt: serverTimestamp(),
    });

    if (mobileRef) {
      tx.set(mobileRef, {
        uid: params.uid,
        username,
        authEmail,
        createdAt: serverTimestamp(),
      });
    }
   })
  );

  // The email index is now BEST EFFORT, and is written outside the transaction
  // on purpose. Several accounts may share one address, and only the first can
  // own the row — the rules allow a create but not an overwrite. Inside the
  // transaction that denial would roll back a perfectly valid registration; out
  // here it costs nothing, because "forgot username" falls back to the mobile
  // number, which is the identifier that is actually unique.
  // An account with no address indexes nothing. Hashing the empty string would
  // give every emailless account the same row, so the first one to register
  // would "own" an address that does not exist and the rest would collide with
  // it — a lookup table for a thing nobody can look up.
  if (!email) return;

  /*
   * Sent, not waited for.
   *
   * This row only helps "forgot username" find somebody by email, and the
   * comment above already calls it best effort — several accounts may share an
   * address and only the first can own the row, so a failure here is the
   * ORDINARY case rather than an exceptional one. Awaiting it added a network
   * round-trip to the end of registration purely to learn something the code
   * then deliberately ignores.
   *
   * Recovery is unaffected either way: the mobile number is the identifier
   * that is actually unique, and it is what "forgot username" falls back to.
   */
  void (async () => {
    try {
      await setDoc(doc(db, EMAIL_LOOKUP, await hashEmail(email)), {
        username,
        uid: params.uid,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Already claimed by whoever registered with this address first.
    }
  })();
}

/** Moves a username claim when an admin renames a user. */
export async function releaseIdentity(username: string, email: string): Promise<void> {
  const emailHash = await hashEmail(email);
  await runTransaction(db, async (tx) => {
    tx.delete(doc(db, COLLECTIONS.usernames, normaliseUsername(username)));
    tx.delete(doc(db, EMAIL_LOOKUP, emailHash));
  });
}

/**
 * Sequential, human-readable ids: `STU-2026-0001`, `TCH-2026-0007`.
 * A counter document per (prefix, year) is incremented in a transaction so ids
 * never collide, even with concurrent registrations.
 */
export async function nextSequentialId(prefix: 'STU' | 'TCH'): Promise<string> {
  const year = new Date().getFullYear();
  const counterId = `${prefix}-${year}`;
  const ref = doc(db, COLLECTIONS.counters, counterId);

  const next = await denialContext('allocate id', `counters/${counterId}`, () =>
   runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? ((snap.data().value as number) ?? 0) : 0;
    const value = current + 1;
    tx.set(ref, { value, prefix, year, updatedAt: serverTimestamp() }, { merge: true });
    return value;
   })
  );

  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
