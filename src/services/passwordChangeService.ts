import { Platform } from 'react-native';
import { serverTimestamp } from 'firebase/firestore';

import { COLLECTIONS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type { AppUser } from '@/types';

import { createDoc } from './firestore';
import * as audit from './auditService';

/**
 * An admin setting somebody's password from the Edit form.
 *
 * THE PROBLEM THIS SOLVES. Only the Admin SDK can set another account's
 * password, so a password typed in the browser has to reach the machine running
 * the sender, and the only channel between them is Firestore. Writing it there
 * in plain text would put a working password in the database — and straight
 * into every nightly backup on disk, which is a file, on a computer, forever.
 *
 * So it is encrypted here, in the browser, with a public key that ships in the
 * app. Only the machine holding the private half can open it. The database sees
 * ciphertext and nothing else; the backups capture ciphertext and nothing else;
 * and the row is deleted once the change is applied.
 *
 * RSA-OAEP with SHA-256, which every browser's Web Crypto provides and which
 * Node can decrypt with no dependency.
 *
 * WHAT IT STILL IS. An admin choosing somebody else's password, which means the
 * admin knows it. A reset link is better wherever it can be used, because then
 * nobody but the person themselves ever knows. This exists for the cases a link
 * cannot cover — somebody standing in front of you who has to get in now.
 */

const PUBLIC_KEY = process.env.EXPO_PUBLIC_PASSWORD_PUBLIC_KEY ?? '';

/** Whether this device can encrypt at all. Web Crypto is web-only here. */
export function canSetPassword(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof globalThis.crypto?.subtle?.importKey === 'function' &&
    PUBLIC_KEY.length > 0
  );
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/** Locks the password to the key only the sender's machine can open. */
async function seal(password: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'spki',
    base64ToBytes(PUBLIC_KEY) as unknown as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  const sealed = await globalThis.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(password) as unknown as BufferSource
  );

  return bytesToBase64(sealed);
}

/**
 * Queues a password change. Returns once the request is written, not once it
 * has been applied — the applying happens on another machine within a minute.
 */
export async function setPassword(
  target: AppUser,
  password: string,
  actor: AppUser
): Promise<void> {
  if (!canSetPassword()) {
    throw new AppError('auth.setPasswordUnavailable', 'password/unsupported');
  }

  const sealed = await seal(password);

  await createDoc(
    COLLECTIONS.passwordChanges,
    {
      uid: target.uid,
      userName: target.fullName,
      // The only form of the password that exists outside the browser it was
      // typed in. Useless without the private key.
      sealed,
      requestedBy: actor.uid,
      status: 'pending' as const,
      error: null,
      requestedAt: serverTimestamp(),
    },
    { actorId: actor.uid }
  );

  // Records that it happened and who did it. Not the password, and not the
  // ciphertext — an audit log outlives the request it describes.
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.users,
    documentId: target.uid,
    summary: `Set a new password for ${target.fullName}`,
  });
}
