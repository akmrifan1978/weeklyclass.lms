import { COLLECTIONS } from '@/constants/app';
import type { AppUser, Note } from '@/types';

import { createDoc, listPage, softDelete, updateDocById, type Page } from './firestore';

/**
 * Private notes.
 *
 * Stored in Firestore rather than on the device, so they survive a new phone —
 * a notebook that vanishes when somebody upgrades is not a notebook. The cost
 * is that they leave the device at all, which is why the rules restrict every
 * operation to the owner's own uid: staff cannot list them, an admin cannot
 * read them, and there is no screen anywhere that shows somebody else's.
 *
 * Deliberately NOT audit-logged. The audit trail is readable by every admin,
 * and a log saying "Rifan edited a note" is a record of private activity that
 * nobody needs and the writer did not agree to.
 */

export function listNotes(user: AppUser, pageSize = 100): Promise<Page<Note>> {
  return listPage<Note>(COLLECTIONS.notes, {
    filters: [['userId', '==', user.uid]],
    orderByField: 'updatedAt',
    direction: 'desc',
    pageSize,
  });
}

export function createNote(
  input: { title: string; body: string },
  user: AppUser
): Promise<string> {
  return createDoc(
    COLLECTIONS.notes,
    {
      userId: user.uid,
      title: input.title.trim(),
      body: input.body.trim(),
      pinned: false,
    },
    { actorId: user.uid }
  );
}

export function updateNote(
  id: string,
  input: Partial<Pick<Note, 'title' | 'body' | 'pinned'>>
): Promise<void> {
  return updateDocById<Note>(COLLECTIONS.notes, id, input);
}

/**
 * Soft delete, like everything else here.
 *
 * A note deleted by a mistimed tap is somebody's only copy of a thought, and
 * the collection is small enough that keeping the row costs nothing.
 */
export function deleteNote(id: string, user: AppUser): Promise<void> {
  return softDelete(COLLECTIONS.notes, id, user.uid);
}

/** Pinned first, then most recently changed. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return 0;
  });
}
