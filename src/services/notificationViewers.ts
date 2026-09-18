import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import type { AppNotification } from '@/types';

import { countWhere } from './firestore';

/**
 * Who has seen a notification, and how many it went to.
 *
 * The names come from `readBy`, which every reader already adds themselves to
 * when they open one, so nothing new is recorded and nothing is tracked beyond
 * what the unread badge already needed. Read only when an admin opens a
 * notification to look — not for every row of the list — so an ordinary visit
 * to the page costs nothing extra.
 *
 * Staff only: the rules let nobody else list accounts.
 */

export interface Viewers {
  /** Names of everyone who has opened it, A to Z. */
  names: string[];
  count: number;
  /** How many people it was sent to, when that can be counted. */
  audience: number | null;
}

export async function viewersOf(notification: AppNotification): Promise<Viewers> {
  const ids = Array.from(new Set(notification.readBy ?? []));
  const found = new Map<string, string>();
  // Thirty at a time: the most one "in" query accepts.
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.users), where(documentId(), 'in', ids.slice(i, i + 30)))
    );
    snap.docs.forEach((doc) => found.set(doc.id, String(doc.data().fullName ?? '')));
  }
  const names = ids.map((id) => found.get(id) || '—').sort((a, b) => a.localeCompare(b));
  const audience = await audienceOf(notification).catch(() => null);
  return { names, count: ids.length, audience };
}

/**
 * How many active accounts a notification was addressed to. A count, which
 * Firestore answers without reading the accounts themselves.
 */
async function audienceOf(notification: AppNotification): Promise<number | null> {
  const active: [string, '==', unknown] = ['status', '==', 'active'];
  switch (notification.targetRole) {
    case 'user':
      return 1;
    case 'class':
      return notification.targetClassId
        ? countWhere(COLLECTIONS.users, [
            ['role', '==', 'student'],
            ['classId', '==', notification.targetClassId],
            active,
          ])
        : null;
    case 'branch':
      return notification.targetBranchId
        ? countWhere(COLLECTIONS.users, [['branchId', '==', notification.targetBranchId], active])
        : null;
    case 'students':
      return countWhere(COLLECTIONS.users, [['role', '==', 'student'], active]);
    case 'teachers':
      return countWhere(COLLECTIONS.users, [['role', '==', 'teacher'], active]);
    case 'all':
      return countWhere(COLLECTIONS.users, [active]);
    default:
      return null;
  }
}
