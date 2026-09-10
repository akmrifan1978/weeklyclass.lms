import type { Unsubscribe } from 'firebase/firestore';

import { COLLECTIONS } from '@/constants/app';
import {
  createDoc,
  getById,
  listAll,
  listPage,
  softDelete,
  updateDocById,
  watchList,
  type Cursor,
  type Page,
} from './firestore';
import * as audit from './auditService';
import * as storageService from './storageService';
import type { AppUser, Flyer, FlyerPosition } from '@/types';

/**
 * Advertising flyers.
 *
 * An admin uploads a poster, says where and when it runs, and the app shows it.
 * Nothing here is automatic: no flyer appears because of anything a person did,
 * and none is scheduled by the platform on the centre's behalf.
 */

/** Every flyer, for the admin screen. Inactive and expired ones included. */
export function listFlyers(cursor: Cursor = null, search = ''): Promise<Page<Flyer>> {
  return listPage<Flyer>(COLLECTIONS.flyers, {
    orderByField: 'priority',
    direction: 'desc',
    cursor,
    pageSize: 50,
    ...(search ? { filters: [] } : {}),
  });
}

/**
 * Whether a flyer should be on screen today.
 *
 * Decided here rather than in the query for two reasons. Firestore cannot apply
 * range filters to two different fields in one query, and `startDate <= today
 * AND endDate >= today` is exactly that. And the dates are optional: a flyer
 * with no end is meant to run until somebody stops it, which no range filter
 * expresses.
 *
 * Compared as plain `YYYY-MM-DD` strings, which sort correctly as text and
 * raise no question about whose midnight is meant.
 */
export function isShowing(flyer: Flyer, today = new Date().toISOString().slice(0, 10)): boolean {
  if (!flyer.active) return false;
  if (flyer.startDate && flyer.startDate > today) return false;
  if (flyer.endDate && flyer.endDate < today) return false;
  return true;
}

/** Whether a flyer belongs in a given place. */
function isFor(flyer: Flyer, position: Exclude<FlyerPosition, 'both'>): boolean {
  return flyer.position === position || flyer.position === 'both';
}

/**
 * The flyers on show in one place, kept up to date.
 *
 * Live, because a flyer is precisely the sort of thing somebody switches on
 * during an event and wants to see appear.
 *
 * The query asks only for active flyers by priority; the dates and the position
 * are applied here. That keeps it to one index and means a flyer whose end date
 * passes at midnight drops off the screen without anybody re-querying.
 */
export function watchShowing(
  position: Exclude<FlyerPosition, 'both'>,
  onNext: (flyers: Flyer[]) => void,
  onError?: (error: unknown) => void,
  limit = 10
): Unsubscribe {
  return watchList<Flyer>(
    COLLECTIONS.flyers,
    {
      filters: [['active', '==', true]],
      orderByField: 'priority',
      direction: 'desc',
      pageSize: 50,
    },
    (all) => onNext(all.filter((f) => isShowing(f) && isFor(f, position)).slice(0, limit)),
    onError
  );
}

/** The same, fetched once, for a screen that has no reason to subscribe. */
export async function listShowing(
  position: Exclude<FlyerPosition, 'both'>,
  limit = 10
): Promise<Flyer[]> {
  const all = await listAll<Flyer>(COLLECTIONS.flyers, {
    filters: [['active', '==', true]],
    orderByField: 'priority',
    direction: 'desc',
    pageSize: 50,
  }).catch(() => [] as Flyer[]);

  return all.filter((f) => isShowing(f) && isFor(f, position)).slice(0, limit);
}

export function getFlyer(id: string): Promise<Flyer | null> {
  return getById<Flyer>(COLLECTIONS.flyers, id);
}

export async function saveFlyer(
  data: Partial<Flyer> & { title: string; fileUrl: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    description: null,
    link: null,
    position: 'dashboard' as FlyerPosition,
    startDate: null,
    endDate: null,
    active: true,
    priority: 0,
    fileType: 'image' as const,
    ...data,
  };

  if (id) {
    const before = await getFlyer(id);

    // Replacing the file removes the one it replaced. A poster swapped every
    // week would otherwise leave a year of dead uploads behind it, and the
    // free tier is a finite thing.
    if (before?.storagePath && before.storagePath !== payload.storagePath) {
      await storageService.remove(before.storagePath).catch(() => undefined);
    }

    await updateDocById<Flyer>(COLLECTIONS.flyers, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.flyers,
      documentId: id,
      summary: `Updated flyer "${payload.title}"`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        payload as unknown as Record<string, unknown>
      ),
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.flyers, payload, { actorId: actor.uid });
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.flyers,
    documentId: newId,
    summary: `Added flyer "${payload.title}"`,
  });
  return newId;
}

/**
 * Switches a flyer on or off without opening the form.
 *
 * The common case by far — a poster comes down the morning after the event —
 * and making somebody open an edit sheet to tick one box is how a flyer ends
 * up still advertising last month.
 */
export async function setActive(flyer: Flyer, active: boolean, actor: AppUser): Promise<void> {
  await updateDocById<Flyer>(COLLECTIONS.flyers, flyer.id, { active });
  await audit.log({
    actor,
    action: active ? 'ACTIVATE' : 'DEACTIVATE',
    collection: COLLECTIONS.flyers,
    documentId: flyer.id,
    summary: `${active ? 'Showed' : 'Hid'} flyer "${flyer.title}"`,
  });
}

export async function deleteFlyer(flyer: Flyer, actor: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.flyers, flyer.id, actor.uid);

  // The upload goes too. A deleted flyer nobody can reach is still a file
  // somebody is paying for.
  if (flyer.storagePath) await storageService.remove(flyer.storagePath).catch(() => undefined);

  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.flyers,
    documentId: flyer.id,
    summary: `Removed flyer "${flyer.title}"`,
  });
}
