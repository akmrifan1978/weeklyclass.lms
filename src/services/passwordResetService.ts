import { serverTimestamp } from 'firebase/firestore';

import { COLLECTIONS } from '@/constants/app';
import type { AppUser, BaseDoc } from '@/types';

import { createDoc, updateDocById, watchList } from './firestore';
import * as audit from './auditService';

/**
 * An admin resetting somebody's password, without ever handling the password.
 *
 * WHY IT WORKS THIS WAY. A Firebase client cannot set another account's
 * password — only the Admin SDK can, and that needs a trusted machine. The app
 * therefore does not try. It records a request; the machine already running the
 * notification sender picks it up, asks Firebase for a one-time reset link, and
 * writes the link back. The admin hands that link to the person, who sets their
 * own password on Firebase's own page, at which point the old one stops working
 * immediately.
 *
 * So no password is ever typed by an admin, stored in Firestore, or sent
 * anywhere. The only thing that moves is a link that expires and can be used
 * once.
 *
 * IT WORKS FOR MOBILE-ONLY ACCOUNTS. A reset EMAIL cannot reach somebody whose
 * sign-in address is a synthetic `@mobile...` one, because no such inbox
 * exists. A link handed over in person does not care.
 *
 * THE LINK IS A CREDENTIAL. Anybody holding it can set that account's password,
 * which is why the security rules keep this collection to admins alone, and why
 * a request is cleared once it has been used.
 */

export interface PasswordResetRequest extends BaseDoc {
  uid: string;
  userName: string;
  /** Sign-in address the link was generated for, shown so an admin can check. */
  email: string;
  requestedBy: string;
  status: 'pending' | 'ready' | 'failed';
  /** Present only once the worker has produced it. */
  link?: string | null;
  /** Why it could not be produced, when it could not. */
  error?: string | null;
}

/**
 * Asks for a link. Returns the request id so the caller can follow it.
 *
 * The audit entry records that a reset was requested and by whom. It does not
 * record the link, which would put a working credential in a log that outlives
 * it.
 */
export async function requestReset(target: AppUser, actor: AppUser): Promise<string> {
  const id = await createDoc(
    COLLECTIONS.passwordResets,
    {
      uid: target.uid,
      userName: target.fullName,
      email: target.authEmail ?? target.email ?? '',
      requestedBy: actor.uid,
      status: 'pending' as const,
      link: null,
      error: null,
      requestedAt: serverTimestamp(),
    },
    { actorId: actor.uid }
  );

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.users,
    documentId: target.uid,
    summary: `Requested a password reset link for ${target.fullName}`,
  });

  return id;
}

/**
 * The requests an admin still has to act on.
 *
 * Live, because the link arrives from a machine rather than from this app —
 * there is nothing here to await, and polling for it would be guesswork about
 * how long the worker takes.
 */
export function watchPending(
  onNext: (items: PasswordResetRequest[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return watchList<PasswordResetRequest>(
    COLLECTIONS.passwordResets,
    { orderByField: 'createdAt', direction: 'desc', pageSize: 20 },
    onNext,
    onError
  );
}

/**
 * Done with it.
 *
 * Soft-deleted along with the link itself: the row is worth keeping as a record
 * that a reset happened, the link is not worth keeping at all once it has been
 * handed over.
 */
export async function clearReset(id: string): Promise<void> {
  await updateDocById<PasswordResetRequest>(COLLECTIONS.passwordResets, id, {
    link: null,
    deleted: true,
  });
}
