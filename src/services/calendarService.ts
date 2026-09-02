import { COLLECTIONS } from '@/constants/app';
import { combineDateTime, toISODate } from '@/utils/date';
import type { AppUser, CalendarEvent } from '@/types';
import {
  createDoc,
  getById,
  listAll,
  listPage,
  softDelete,
  updateDocById,
  type Cursor,
  type Page,
} from './firestore';
import * as audit from './auditService';

/**
 * Calendar.
 *
 * Events keep both the human fields (`date`, `startTime`, `endTime`) and a
 * precomputed `startsAt` instant. Queries and ordering use `startsAt`; the
 * display uses the strings, so an event scheduled for "9:00 PM in Jeddah"
 * reads the same everywhere.
 */

export interface EventQuery {
  branchId?: string;
  classId?: string;
  audience?: CalendarEvent['targetAudience'];
  cursor?: Cursor;
  pageSize?: number;
}

/** Events that have not started yet, soonest first. */
export function listUpcoming(options: EventQuery = {}): Promise<Page<CalendarEvent>> {
  return listPage<CalendarEvent>(COLLECTIONS.calendarEvents, {
    filters: [
      ['startsAt', '>=', new Date()],
      options.branchId ? ['branchId', '==', options.branchId] : null,
      options.classId ? ['classId', '==', options.classId] : null,
    ],
    orderByField: 'startsAt',
    direction: 'asc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? 20,
  });
}

export function listPast(options: EventQuery = {}): Promise<Page<CalendarEvent>> {
  return listPage<CalendarEvent>(COLLECTIONS.calendarEvents, {
    filters: [
      ['startsAt', '<', new Date()],
      options.branchId ? ['branchId', '==', options.branchId] : null,
      options.classId ? ['classId', '==', options.classId] : null,
    ],
    orderByField: 'startsAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? 20,
  });
}

/**
 * The single event shown on the dashboard.
 *
 * Firestore cannot OR `classId == mine` with `classId == null` in one query, so
 * both are fetched (2 documents total) and the earlier one wins.
 */
export async function nextEventFor(user: {
  role: string;
  classId?: string | null;
  branchId?: string | null;
}): Promise<CalendarEvent | null> {
  const now = new Date();
  const audience = user.role === 'teacher' ? 'teachers' : 'students';

  const base = {
    orderByField: 'startsAt',
    direction: 'asc' as const,
    pageSize: 1,
  };

  const [general, mine] = await Promise.all([
    listAll<CalendarEvent>(COLLECTIONS.calendarEvents, {
      ...base,
      filters: [
        ['startsAt', '>=', now],
        ['classId', '==', null],
        ['targetAudience', 'in', ['all', audience]],
      ],
    }),
    user.classId
      ? listAll<CalendarEvent>(COLLECTIONS.calendarEvents, {
          ...base,
          filters: [
            ['startsAt', '>=', now],
            ['classId', '==', user.classId],
          ],
        })
      : Promise.resolve<CalendarEvent[]>([]),
  ]);

  const candidates = [...general, ...mine].filter((e) => e.status === 'scheduled');
  if (candidates.length === 0) return null;

  return candidates.reduce((earliest, event) => {
    const a = earliest.startsAt && 'seconds' in earliest.startsAt ? earliest.startsAt.seconds : 0;
    const b = event.startsAt && 'seconds' in event.startsAt ? event.startsAt.seconds : 0;
    return b < a ? event : earliest;
  });
}

export function getEvent(id: string): Promise<CalendarEvent | null> {
  return getById<CalendarEvent>(COLLECTIONS.calendarEvents, id);
}

export async function saveEvent(
  data: Partial<CalendarEvent> & { title: string; date: string; startTime: string; endTime: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    targetAudience: 'all' as const,
    status: 'scheduled' as const,
    ...data,
    startsAt: combineDateTime(data.date, data.startTime),
  };

  if (id) {
    const before = await getEvent(id);
    await updateDocById<CalendarEvent>(COLLECTIONS.calendarEvents, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.calendarEvents,
      documentId: id,
      summary: `Updated event "${data.title}"`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        payload as unknown as Record<string, unknown>
      ),
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.calendarEvents, payload, { actorId: actor.uid });
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.calendarEvents,
    documentId: newId,
    summary: `Added event "${data.title}" on ${data.date}`,
  });
  return newId;
}

export async function deleteEvent(id: string, actor: AppUser): Promise<void> {
  const before = await getEvent(id);
  await softDelete(COLLECTIONS.calendarEvents, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.calendarEvents,
    documentId: id,
    summary: `Removed event "${before?.title ?? id}"`,
  });
}

/** Groups events by ISO date for a month or agenda view. */
export function groupByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const groups: Record<string, CalendarEvent[]> = {};
  for (const event of events) {
    const key = event.date || toISODate();
    (groups[key] ??= []).push(event);
  }
  for (const key of Object.keys(groups)) {
    groups[key]?.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return groups;
}
