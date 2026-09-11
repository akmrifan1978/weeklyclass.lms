import { COLLECTIONS } from '@/constants/app';
import { combineDateTime, toISODate } from '@/utils/date';
import type {
  AppUser,
  CalendarEvent,
  MeetingProvider,
  RegistrationStatus,
} from '@/types';
import { db } from '@/firebase/config';
import { doc, deleteDoc, setDoc } from 'firebase/firestore';
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
import { announce } from './announceService';
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

/**
 * The upcoming events one person should actually see.
 *
 * THE BUG THIS FIXES. Screens asked `listUpcoming({ classId })`, which filters
 * to events belonging to that class — and an event open to the whole centre
 * belongs to NO class, because `classId` being empty is precisely how an event
 * is marked as everybody's (see syncPublicSchedule). So a student in a class
 * saw their class's events and nothing else: every centre-wide event an admin
 * created was filtered out of the calendar that existed to show it. A student
 * in no class saw everything and looked fine, which is why it survived.
 *
 * Two queries, because Firestore cannot ask for "classId is empty OR classId
 * is mine" in one. Merged, sorted and cut to size here.
 *
 * The audience is filtered in memory rather than in the query. An event saved
 * before `targetAudience` had a default has no such field, and an `in` filter
 * skips documents missing the field entirely — which would have hidden exactly
 * the older events this function exists to stop hiding. Absent is read as
 * "everybody", which is what it meant.
 */
export async function listUpcomingForUser(
  options: { classId?: string | null; role?: AppUser['role']; pageSize?: number } = {}
): Promise<CalendarEvent[]> {
  const pageSize = options.pageSize ?? 20;
  const now = new Date();

  const everyones = listAll<CalendarEvent>(COLLECTIONS.calendarEvents, {
    filters: [
      ['startsAt', '>=', now],
      ['classId', '==', null],
    ],
    orderByField: 'startsAt',
    direction: 'asc',
    pageSize,
  }).catch(() => [] as CalendarEvent[]);

  const mine = options.classId
    ? listAll<CalendarEvent>(COLLECTIONS.calendarEvents, {
        filters: [
          ['startsAt', '>=', now],
          ['classId', '==', options.classId],
        ],
        orderByField: 'startsAt',
        direction: 'asc',
        pageSize,
      }).catch(() => [] as CalendarEvent[])
    : Promise.resolve<CalendarEvent[]>([]);

  const [open, scoped] = await Promise.all([everyones, mine]);

  const merged = new Map<string, CalendarEvent>();
  for (const event of [...open, ...scoped]) merged.set(event.id, event);

  return Array.from(merged.values())
    .filter((event) => {
      const audience = event.targetAudience ?? 'all';
      if (audience === 'all' || !options.role) return true;
      if (options.role === 'student') return audience === 'students';
      if (options.role === 'teacher') return audience === 'teachers';
      // An admin is nobody's target audience and should see the lot.
      return true;
    })
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
    .slice(0, pageSize);
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

/**
 * The schedule, as much of it as a stranger may see.
 *
 * The sign-in screen advertises what is coming up, and a signed-out visitor
 * cannot read `calendarEvents` — nor should they. A calendar entry carries the
 * meeting link, and Firestore rules grant or refuse a whole document: there is
 * no way to publish the title while withholding the URL. Anyone with the link
 * can walk into the class.
 *
 * So a deliberately thin copy is kept alongside it, containing only what a
 * poster would say — what, when, where, the picture, and a line about it. No
 * link, no audience, no attendee count, no booking.
 *
 * WHAT IS MIRRORED, and why it changed. It used to be classes only, on the
 * reasoning that a ticketed event belonged behind a sign-in with its seat
 * count. But the point of the sign-in screen is to show somebody who has not
 * joined yet what this place does, and a public event is the strongest thing
 * it has to show them. So ticketed events are mirrored now as well, carrying a
 * `takesBookings` flag so the card can offer a way in.
 *
 * WHAT IS NOT MIRRORED: anything scoped to one class. That is a private
 * arrangement between a teacher and their students, and a stranger has no
 * business reading its title, its venue or the hour it starts. This is
 * narrower than the old rule, which advertised class-scoped classes to the
 * world — the sign-in page keeps only what is genuinely open to everybody.
 */
async function syncPublicSchedule(id: string, event: Partial<CalendarEvent>): Promise<void> {
  const isPublic = !event.classId;
  const path = `${COLLECTIONS.publicSchedule}/${id}`;

  try {
    if (!isPublic) {
      // It was open to everybody and has been narrowed to one class: withdraw
      // the public copy rather than leave one advertising it.
      await deleteDoc(doc(db, COLLECTIONS.publicSchedule, id));
      return;
    }

    await setDoc(doc(db, COLLECTIONS.publicSchedule, id), {
      title: event.title ?? '',
      description: event.description ?? null,
      date: event.date ?? '',
      startTime: event.startTime ?? '',
      endTime: event.endTime ?? '',
      venue: event.venue ?? null,
      location: event.location ?? null,
      topic: event.topic ?? null,
      speaker: event.speaker ?? null,
      bannerUrl: event.bannerUrl ?? null,
      // Whether there is something to book. Deliberately a boolean and not the
      // registration block: the seat count, the price and the bookings stay
      // behind a sign-in where they belong.
      takesBookings: Boolean(event.registration),
      // Published as the organiser set it. Opening soon says opening soon.
      registrationStatus: event.registration?.status ?? null,
      startsAt: combineDateTime(event.date ?? '', event.startTime ?? ''),
      deleted: false,
    });
  } catch (error) {
    // Never fails the save. The calendar entry is the record that matters; the
    // advertisement is a convenience, and losing it must not lose the class.
    console.warn(`[WeeklyClass] could not update ${path}:`, error);
  }
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
    await syncPublicSchedule(id, { ...(before ?? {}), ...payload });
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
  await syncPublicSchedule(newId, payload);

  // Telling people is the point of putting it on the calendar. Fire and forget,
  // like every other publish: an event that saved but could not be announced is
  // still an event, and rolling it back would be the worse outcome.
  void announce(
    {
      kind: 'event',
      title: payload.title,
      classId: payload.classId ?? null,
      branchId: payload.branchId ?? null,
      published: payload.status === 'scheduled',
      image: payload.bannerUrl ?? null,
    },
    actor
  );
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
  // The public copy is hard-deleted rather than flagged: it exists only to be
  // read by strangers, and a soft-deleted advertisement is still an
  // advertisement unless every reader remembers to filter it.
  await deleteDoc(doc(db, COLLECTIONS.publicSchedule, id)).catch(() => undefined);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.calendarEvents,
    documentId: id,
    summary: `Removed event "${before?.title ?? id}"`,
  });
}

export interface PublicClass {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  venue?: string | null;
  location?: string | null;
  speaker?: string | null;
  bannerUrl?: string | null;
  /** True when this event takes bookings, so the card can offer a way in. */
  takesBookings?: boolean;
  /**
   * Whether booking is open, opening soon, or closed.
   *
   * `takesBookings` alone said only that an event HAS a registration block,
   * which the public page then advertised as "Registration open" — including
   * for an event whose organiser had deliberately set it to opening soon. An
   * announcement that misstates whether you can book yet is worse than no
   * announcement.
   *
   * Optional because events saved before this existed have no such field, and
   * those keep the old reading until they are next saved.
   */
  registrationStatus?: RegistrationStatus | null;
}

/**
 * The upcoming classes a signed-out visitor may see.
 *
 * Reads the thin public copy, never `calendarEvents` — see syncPublicSchedule
 * for why that distinction is the whole point.
 */
export async function listPublicClasses(limit = 6): Promise<PublicClass[]> {
  const rows = await listAll<PublicClass & { startsAt?: unknown }>(
    COLLECTIONS.publicSchedule,
    {
      filters: [['startsAt', '>=', new Date()]],
      orderByField: 'startsAt',
      direction: 'asc',
      pageSize: limit,
    }
  ).catch((error) => {
    console.warn('[WeeklyClass] could not read the public schedule:', error);
    return [];
  });
  return rows;
}

/**
 * The same list, kept live.
 *
 * A snapshot listener rather than a fetch, for two reasons that both came from
 * the same complaint. An event added by an admin appears on everybody's screen
 * without them reloading, and — because Firestore answers a listener from its
 * own cache first — the last known list is on screen immediately, including
 * with no connection at all, and is replaced the moment the server has
 * something newer.
 *
 * Returns an unsubscribe. Errors are reported to the caller rather than thrown,
 * because a sign-in screen that fails to load its advertisement should still be
 * a sign-in screen.
 */
export function watchPublicSchedule(
  limit: number,
  onNext: (rows: PublicClass[]) => void
): () => void {
  return watchList<PublicClass & { deleted?: boolean }>(
    COLLECTIONS.publicSchedule,
    {
      filters: [['startsAt', '>=', new Date()]],
      orderByField: 'startsAt',
      direction: 'asc',
      pageSize: limit,
    },
    onNext,
    (error) => console.warn('[WeeklyClass] public schedule listener stopped:', error)
  );
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
