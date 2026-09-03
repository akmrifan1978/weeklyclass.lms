import { COLLECTIONS } from '@/constants/app';
import { combineDateTime, toISODate } from '@/utils/date';
import type { AppUser, CalendarEvent, MeetingProvider } from '@/types';
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
import { cached } from './offlineCache';

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

/**
 * Recognises the platform from a pasted meeting link.
 *
 * The provider is only ever a label on the join button — opening the link is
 * what actually happens — so guessing it saves the admin a field and is
 * harmless when it guesses "other".
 */
export function detectMeetingProvider(url: string): MeetingProvider {
  const value = url.toLowerCase();
  if (value.includes('zoom.us') || value.includes('zoom.com')) return 'zoom';
  if (value.includes('meet.google.com')) return 'meet';
  return 'other';
}

/**
 * Events sharing a start time, grouped so parallel sessions read as parallel
 * rather than as an ambiguous list. Several classes running at once is normal
 * here — different languages or levels at the same hour — so the UI has to make
 * that obvious instead of hiding it in ordering.
 */
export function groupByTimeSlot(
  events: CalendarEvent[]
): { startTime: string; events: CalendarEvent[] }[] {
  const slots = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.startTime || '00:00';
    const bucket = slots.get(key) ?? [];
    bucket.push(event);
    slots.set(key, bucket);
  }
  return Array.from(slots.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([startTime, list]) => ({ startTime, events: list }));
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

// ---------------------------------------------------------------------------
// Online classes
// ---------------------------------------------------------------------------

/**
 * An online class IS a calendar event — one that carries a meeting link. Giving
 * it a separate collection would mean two things to keep in step, two places to
 * look for "what is on this week", and a session that could go missing from the
 * calendar it obviously belongs in.
 *
 * Firestore cannot filter on "field is not null" alongside an ordered range on
 * another field without a composite index for every combination, so the meeting
 * filter is applied in memory over an already-narrow page of upcoming events.
 */
export function isOnlineClass(event: CalendarEvent): boolean {
  return Boolean(event.meetingUrl);
}

export async function listOnlineClasses(options: EventQuery = {}): Promise<CalendarEvent[]> {
  const result = await cached(`onlineClasses/${options.classId ?? 'all'}`, async () => {
    const page = await listUpcoming({ ...options, pageSize: options.pageSize ?? 50 });
    return page.items.filter(isOnlineClass);
  });
  return result.data;
}

/**
 * Whether a session is joinable now.
 *
 * Opened fifteen minutes early, because people arrive before the hour and a join
 * button that refuses until the exact minute is worse than useless. It stays
 * open until the end time so latecomers are not locked out.
 */
export function joinWindow(
  event: CalendarEvent,
  now: Date = new Date()
): 'upcoming' | 'live' | 'ended' {
  const start = combineDateTime(event.date, event.startTime).getTime();
  const end = combineDateTime(event.date, event.endTime).getTime();
  const EARLY_MS = 15 * 60 * 1000;

  if (now.getTime() < start - EARLY_MS) return 'upcoming';
  if (now.getTime() > end) return 'ended';
  return 'live';
}

/**
 * Everyone conducting a session, from whichever shape the record uses.
 *
 * Sessions saved before a class could have several teachers carry a single
 * `teacherId`; newer ones carry `teacherIds`. Reading both here means no
 * migration and no screen that has to know which era a record came from.
 */
export function teachersFor(event: CalendarEvent): string[] {
  if (event.teacherIds?.length) return event.teacherIds;
  return event.teacherId ? [event.teacherId] : [];
}
