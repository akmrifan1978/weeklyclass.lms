import { arrayUnion, doc, updateDoc } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { toDate } from '@/utils/date';
import type {
  Announcement,
  AppNotification,
  AppUser,
  NotificationCategory,
  NotificationTarget,
  Priority,
} from '@/types';
import {
  createDoc,
  getById,
  listAll,
  listPage,
  softDelete,
  updateDocById,
  watchList,
  type Cursor,
  type ListOptions,
  type Page,
} from './firestore';
import { sendExpoPush, type PushSendReport } from './pushService';
import * as audit from './auditService';
import { cached } from './offlineCache';

/**
 * Notifications and announcements.
 *
 * Two delivery paths, deliberately kept separate:
 *
 *  IMMEDIATE  — the record is written with `status: 'sent'` and every targeted
 *               user sees it in-app straight away (Firestore listener). Native
 *               devices additionally get a real push via the Expo Push Service.
 *
 *  SCHEDULED  — the record is written with `status: 'scheduled'` and a
 *               `scheduledAt`. It becomes visible in-app at that time (the
 *               query filters on `scheduledAt <= now`). Device push at that
 *               exact moment needs a server job; see `docs/NOTIFICATIONS.md`.
 *               Nothing here has to change when Cloud Functions are enabled —
 *               a function simply picks up `status == 'scheduled'` rows.
 */

export interface SendInput {
  title: string;
  message: string;
  image?: string | null;
  category?: NotificationCategory;
  targetRole: NotificationTarget;
  targetClassId?: string | null;
  targetBranchId?: string | null;
  userId?: string | null;
  route?: string | null;
  /** Omit for immediate delivery. */
  scheduledAt?: Date | null;
}

export interface SendOutcome {
  id: string;
  kind: 'immediate' | 'scheduled';
  push: PushSendReport;
  /** Human-readable note stored on the record and shown to the admin. */
  note: string;
}

/** Resolves a target audience to the users it covers. Admin-only read. */
async function resolveRecipients(input: SendInput): Promise<AppUser[]> {
  const base = { pageSize: 500, orderByField: undefined };

  switch (input.targetRole) {
    case 'user':
      if (!input.userId) return [];
      return listAll<AppUser>(COLLECTIONS.users, {
        ...base,
        filters: [['uid', '==', input.userId]],
      });
    case 'class':
      if (!input.targetClassId) return [];
      return listAll<AppUser>(COLLECTIONS.users, {
        ...base,
        filters: [
          ['classId', '==', input.targetClassId],
          ['status', '==', 'active'],
        ],
      });
    case 'branch':
      if (!input.targetBranchId) return [];
      return listAll<AppUser>(COLLECTIONS.users, {
        ...base,
        filters: [
          ['branchId', '==', input.targetBranchId],
          ['status', '==', 'active'],
        ],
      });
    case 'students':
      return listAll<AppUser>(COLLECTIONS.users, {
        ...base,
        filters: [
          ['role', '==', 'student'],
          ['status', '==', 'active'],
        ],
      });
    case 'teachers':
      return listAll<AppUser>(COLLECTIONS.users, {
        ...base,
        filters: [
          ['role', '==', 'teacher'],
          ['status', '==', 'active'],
        ],
      });
    case 'all':
    default:
      return listAll<AppUser>(COLLECTIONS.users, {
        ...base,
        filters: [['status', '==', 'active']],
      });
  }
}

export async function send(input: SendInput, actor: AppUser): Promise<SendOutcome> {
  const scheduled = input.scheduledAt && input.scheduledAt.getTime() > Date.now();

  const record = {
    title: input.title.trim(),
    message: input.message.trim(),
    image: input.image ?? null,
    category: input.category ?? ('general' as NotificationCategory),
    kind: scheduled ? ('scheduled' as const) : ('immediate' as const),
    targetRole: input.targetRole,
    targetClassId: input.targetClassId ?? null,
    targetBranchId: input.targetBranchId ?? null,
    userId: input.userId ?? null,
    route: input.route ?? null,
    scheduledAt: scheduled ? input.scheduledAt : null,
    sentAt: scheduled ? null : new Date(),
    status: scheduled ? ('scheduled' as const) : ('sent' as const),
    readBy: [] as string[],
  };

  const id = await createDoc(COLLECTIONS.notifications, record, { actorId: actor.uid });

  let push: PushSendReport = { attempted: 0, accepted: 0, failed: 0 };
  let note: string;

  if (scheduled) {
    note =
      'Stored as a scheduled notification. It appears in the app at the chosen time. ' +
      'Device push at that exact moment requires a Cloud Function (Blaze plan).';
  } else {
    const recipients = await resolveRecipients(input);
    const tokens = recipients.flatMap((user) => Object.values(user.pushTokens ?? {}));
    push = await sendExpoPush({
      to: tokens,
      title: record.title,
      body: record.message,
      data: { notificationId: id, route: record.route },
    });
    note =
      push.attempted === 0
        ? `Delivered in-app to ${recipients.length} user(s). No registered devices to push to.`
        : `Delivered in-app to ${recipients.length} user(s); pushed to ${push.accepted}/${push.attempted} device(s).`;
  }

  await updateDocById<AppNotification>(COLLECTIONS.notifications, id, {
    deliveryNote: note,
  });

  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.notifications,
    documentId: id,
    summary: `${scheduled ? 'Scheduled' : 'Sent'} notification "${record.title}" to ${input.targetRole}`,
  });

  return { id, kind: record.kind, push, note };
}

/**
 * Notifications visible to one user.
 *
 * Firestore cannot OR across fields, so each audience the user belongs to is
 * one small query and the results are merged. That is 3-4 reads per refresh,
 * which is well inside the free daily quota.
 */
function inboxQueries(user: AppUser, pageSize: number): ListOptions[] {
  const audience: NotificationTarget = user.role === 'teacher' ? 'teachers' : 'students';
  const base = { orderByField: 'createdAt', direction: 'desc' as const, pageSize };

  // Annotated rather than inferred: without it the literal filters widen to
  // string[][] and stop matching the tuple ListOptions expects.
  const specs: (ListOptions | null)[] = [
    { ...base, filters: [['targetRole', '==', 'all']] },
    { ...base, filters: [['targetRole', '==', audience]] },
    { ...base, filters: [['userId', '==', user.uid]] },
    user.classId ? { ...base, filters: [['targetClassId', '==', user.classId]] } : null,
    user.branchId ? { ...base, filters: [['targetBranchId', '==', user.branchId]] } : null,
  ];
  return specs.filter((spec): spec is ListOptions => spec !== null);
}

/** Merges the audience queries into the one list a reader should see. */
function mergeInbox(
  groups: AppNotification[][],
  pageSize: number,
  now = new Date()
): AppNotification[] {
  const merged = new Map<string, AppNotification>();
  for (const item of groups.flat()) {
    // A scheduled notification stays hidden until its moment arrives.
    if (item.status === 'scheduled') {
      const at = toDate(item.scheduledAt);
      if (!at || at > now) continue;
    }
    if (item.status === 'cancelled' || item.status === 'draft') continue;
    merged.set(item.id, item);
  }

  return Array.from(merged.values())
    .sort((a, b) => sortKey(b) - sortKey(a))
    .slice(0, pageSize);
}

export async function inboxFor(user: AppUser, pageSize = 30): Promise<AppNotification[]> {
  const groups = await Promise.all(
    inboxQueries(user, pageSize).map((spec) =>
      listAll<AppNotification>(COLLECTIONS.notifications, spec)
    )
  );
  return mergeInbox(groups, pageSize);
}

/**
 * The same inbox, live.
 *
 * A listener rather than a poll, and the difference is not stylistic. Polling
 * `inboxFor` costs four to five reads every time it runs whether or not
 * anything happened; at one minute apart across a class that alone would eat
 * the free daily quota. A listener is charged for documents actually delivered,
 * so an idle hour costs nothing.
 *
 * This is what lets the app raise a real notification on the phone the moment
 * one is written, with no server anywhere — see `deviceNotify`.
 */
export function watchInbox(
  user: AppUser,
  onNext: (items: AppNotification[]) => void,
  options: { pageSize?: number; onError?: (error: unknown) => void } = {}
): () => void {
  const pageSize = options.pageSize ?? 30;
  const specs = inboxQueries(user, pageSize);
  const groups: AppNotification[][] = specs.map(() => []);

  const unsubscribes = specs.map((spec, index) =>
    watchList<AppNotification>(
      COLLECTIONS.notifications,
      spec,
      (items) => {
        groups[index] = items;
        onNext(mergeInbox(groups, pageSize));
      },
      options.onError
    )
  );

  return () => unsubscribes.forEach((stop) => stop());
}

function sortKey(item: AppNotification): number {
  const when = toDate(item.sentAt) ?? toDate(item.scheduledAt) ?? toDate(item.createdAt);
  return when ? when.getTime() : 0;
}

export function unreadCount(items: AppNotification[], uid: string): number {
  return items.filter((item) => !(item.readBy ?? []).includes(uid)).length;
}

export async function markRead(notificationId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.notifications, notificationId), {
    readBy: arrayUnion(uid),
  }).catch(() => undefined);
}

export async function markAllRead(items: AppNotification[], uid: string): Promise<void> {
  await Promise.all(
    items.filter((i) => !(i.readBy ?? []).includes(uid)).map((i) => markRead(i.id, uid))
  );
}

/** Admin view: everything ever sent or scheduled. */
export function listAllNotifications(options: {
  status?: AppNotification['status'];
  cursor?: Cursor;
  pageSize?: number;
} = {}): Promise<Page<AppNotification>> {
  return listPage<AppNotification>(COLLECTIONS.notifications, {
    filters: [options.status ? ['status', '==', options.status] : null],
    orderByField: 'createdAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

export async function cancelScheduled(id: string, actor: AppUser): Promise<void> {
  await updateDocById<AppNotification>(COLLECTIONS.notifications, id, { status: 'cancelled' });
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.notifications,
    documentId: id,
    summary: 'Cancelled scheduled notification',
  });
}

// --- Announcements ---------------------------------------------------------

export function listAnnouncements(options: {
  classId?: string | null;
  branchId?: string | null;
  pageSize?: number;
} = {}): Promise<Announcement[]> {
  return listAll<Announcement>(COLLECTIONS.announcements, {
    filters: [['status', '==', 'published']],
    orderByField: 'publishedAt',
    direction: 'desc',
    pageSize: options.pageSize ?? 20,
  });
}

/** Announcements aimed at this user, newest and highest priority first. */
export async function announcementsFor(
  user: AppUser,
  pageSize = 10
): Promise<Announcement[]> {
  const result = await cached(`announcements/${user.uid}`, () =>
    fetchAnnouncementsFor(user, pageSize)
  );
  return result.data;
}

async function fetchAnnouncementsFor(user: AppUser, pageSize = 10): Promise<Announcement[]> {
  const all = await listAnnouncements({ pageSize: 40 });
  const audience = user.role === 'teacher' ? 'teachers' : 'students';
  const now = Date.now();

  const priorityRank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  return all
    .filter((item) => {
      const expires = toDate(item.expiresAt);
      if (expires && expires.getTime() < now) return false;
      if (item.targetRole === 'all') return true;
      if (item.targetRole === audience) return true;
      if (item.targetRole === 'class') return item.targetClassId === user.classId;
      if (item.targetRole === 'branch') return item.targetBranchId === user.branchId;
      if (item.targetRole === 'user') return item.userId === user.uid;
      return false;
    })
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
    .slice(0, pageSize);
}

export function getAnnouncement(id: string): Promise<Announcement | null> {
  return getById<Announcement>(COLLECTIONS.announcements, id);
}

export async function saveAnnouncement(
  data: Partial<Announcement> & { title: string; message: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    targetRole: 'all' as NotificationTarget,
    priority: 'normal' as Priority,
    status: 'published' as const,
    publishedAt: new Date(),
    ...data,
  };

  if (id) {
    await updateDocById<Announcement>(COLLECTIONS.announcements, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.announcements,
      documentId: id,
      summary: `Updated announcement "${data.title}"`,
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.announcements, payload, { actorId: actor.uid });
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.announcements,
    documentId: newId,
    summary: `Published announcement "${data.title}"`,
  });
  return newId;
}

/**
 * Removes notifications from the history, one call for however many.
 *
 * Soft-deleted, like everything else: a notification is a record that people
 * were told something, and an admin tidying the list should not be able to
 * erase the evidence that a message went out. It stops appearing, which is
 * what "delete" means from where they are standing.
 *
 * The rules already allowed this — `allow delete: if isAdmin()` — there was
 * simply no way to ask for it from the app.
 *
 * Reported per id. Deleting twenty and having three refused should say which
 * three rather than discarding the seventeen that worked.
 */
export async function deleteNotifications(
  ids: string[],
  actor: AppUser
): Promise<{ removed: number; failed: string[] }> {
  const failed: string[] = [];
  let removed = 0;

  for (const id of ids) {
    try {
      await softDelete(COLLECTIONS.notifications, id, actor.uid);
      removed += 1;
    } catch (error) {
      console.warn(`[WeeklyClass] could not delete notifications/${id}:`, error);
      failed.push(id);
    }
  }

  if (removed > 0) {
    await audit
      .log({
        actor,
        action: 'DELETE',
        collection: COLLECTIONS.notifications,
        documentId: ids[0] ?? '',
        summary: `Removed ${removed} notification(s) from the history`,
      })
      .catch(() => undefined);
  }

  return { removed, failed };
}

export async function deleteAnnouncement(id: string, actor: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.announcements, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.announcements,
    documentId: id,
    summary: 'Removed announcement',
  });
}
