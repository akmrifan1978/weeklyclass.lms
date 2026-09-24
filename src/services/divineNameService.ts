import { COLLECTIONS } from '@/constants/app';
import type { AppUser } from '@/types';

import { listAll, setDocById } from './firestore';
import * as audit from './auditService';

/**
 * The teachers' notes on the ninety-nine names.
 *
 * The names themselves are bundled with the app — they are settled text. The
 * explanations are not bundled and never will be: a paragraph about a name of
 * Allah is teaching, and in this app teaching comes from this centre's own
 * scholars rather than from whoever assembled a data file. The same reasoning
 * kept the Seerah chapters out of the build.
 *
 * So this collection is empty until somebody here writes into it, and a name
 * with no note simply shows its meaning. That is a complete, correct screen —
 * not a broken one waiting for content.
 *
 * Keyed by the name's number rather than an auto id, so a note is written once
 * and edited in place, and there is no way to end up with two notes on Al-Malik
 * disagreeing with each other.
 */

export interface DivineNameNote {
  id: string;
  /** The teachers' explanation. Plain text; paragraphs are kept as typed. */
  explanation: string;
  updatedByName?: string | null;
}

/** Every note there is, as a map from name number to text. */
export async function listNotes(): Promise<Record<number, DivineNameNote>> {
  const rows = await listAll<DivineNameNote & { deleted?: boolean }>(
    COLLECTIONS.divineNames,
    { pageSize: 99 }
  ).catch((error) => {
    // A screen that cannot reach the notes still has ninety-nine names and
    // their meanings, which is most of what it is for.
    console.warn('[WeeklyClass] could not read the divine name notes:', error);
    return [];
  });

  const byNumber: Record<number, DivineNameNote> = {};
  for (const row of rows) {
    const number = Number(row.id);
    if (Number.isFinite(number)) byNumber[number] = row;
  }
  return byNumber;
}

export async function saveNote(
  number: number,
  explanation: string,
  actor: AppUser
): Promise<void> {
  await setDocById(
    COLLECTIONS.divineNames,
    String(number),
    { explanation: explanation.trim(), updatedByName: actor.fullName },
    { actorId: actor.uid }
  );

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.divineNames,
    documentId: String(number),
    summary: `Wrote the note for name ${number}`,
  });
}
