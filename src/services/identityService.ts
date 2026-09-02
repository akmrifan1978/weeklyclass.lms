import * as Crypto from 'expo-crypto';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type { UserRole } from '@/types';

/**
 * Username and email lookup.
 *
 * Signing in with a username means resolving it to an email *before*
 * authenticating, so two tiny public indexes exist:
 *
 *   usernames/{usernameLower}  -> { uid, email, role }
 *   emailLookup/{sha256(email)} -> { username }
 *
 * Security rules allow `get` on these but NOT `list`, so a caller must already
 * know the exact username (or email) to read a row — the collections cannot be
 * enumerated. Email addresses are hashed into the document id so the index
 * never exposes an address to someone who does not already have it.
 *
 * `usernames` doubles as the uniqueness constraint: the transaction below fails
 * if the document already exists, and rules forbid overwriting an existing row.
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

/** Resolves a username to the email address used for Firebase Auth. */
export async function emailForUsername(username: string): Promise<string | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.usernames, normaliseUsername(username)));
  return snap.exists() ? ((snap.data().email as string) ?? null) : null;
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
 * Claims a username for a uid. Runs in a transaction so two people registering
 * the same username at the same moment cannot both succeed.
 */
export async function claimIdentity(params: {
  username: string;
  email: string;
  uid: string;
  role: UserRole;
}): Promise<void> {
  const username = normaliseUsername(params.username);
  const email = params.email.trim().toLowerCase();
  const emailHash = await hashEmail(email);

  await runTransaction(db, async (tx) => {
    const usernameRef = doc(db, COLLECTIONS.usernames, username);
    const existing = await tx.get(usernameRef);
    if (existing.exists() && existing.data().uid !== params.uid) {
      throw new AppError('validation.usernameTaken', 'already-exists');
    }
    tx.set(usernameRef, {
      uid: params.uid,
      email,
      role: params.role,
      createdAt: serverTimestamp(),
    });
    tx.set(doc(db, EMAIL_LOOKUP, emailHash), {
      username,
      uid: params.uid,
      createdAt: serverTimestamp(),
    });
  });
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

  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? ((snap.data().value as number) ?? 0) : 0;
    const value = current + 1;
    tx.set(ref, { value, prefix, year, updatedAt: serverTimestamp() }, { merge: true });
    return value;
  });

  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
