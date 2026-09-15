import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type { AppUser } from '@/types';

/**
 * Live chat between a member and the admin team.
 *
 * ONE THREAD PER PERSON, keyed by their uid: `chats/{uid}` is the summary the
 * inbox lists, `chats/{uid}/messages` is the conversation. A student can only
 * ever write into their own thread and only admins read everybody's, so there
 * is no route by which one student reaches another — and firestore.rules is
 * what enforces that, not this file.
 *
 * LIGHTWEIGHT BY CONSTRUCTION. Nothing listens unless a chat screen is open. A
 * conversation loads its latest sixty messages, not its history. The inbox is
 * one query over the summaries. Sending is a single batched write — the message
 * and the summary together — so the inbox never shows a message the thread
 * does not have.
 */

export const CHAT_MAX_LENGTH = 2000;
const PREVIEW_LENGTH = 120;
const MESSAGE_WINDOW = 60;
const INBOX_SIZE = 50;
const MESSAGES = 'messages';

export interface ChatThreadSummary {
  id: string;
  uid: string;
  userName?: string;
  userRole?: string;
  lastMessage?: string;
  lastFromAdmin?: boolean;
  lastAt?: unknown;
  unreadForAdmin?: number;
  unreadForUser?: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  fromName?: string;
  fromAdmin: boolean;
  text: string;
  at?: unknown;
}

/**
 * Timestamps written a moment ago are still pending on this device. "estimate"
 * gives them the local clock's time, so a sent message shows at once, in the
 * right place, instead of waiting for the server to confirm it.
 */
function read<T>(snap: DocumentSnapshot<DocumentData>): T {
  return { id: snap.id, ...(snap.data({ serverTimestamps: 'estimate' }) as object) } as T;
}

export function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'number') return new Date(value);
  return null;
}

/** "14:05" today, "12 Sep 14:05" before that. */
export function chatTime(value: unknown): string {
  const date = asDate(value);
  if (!date) return '';
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export async function sendChatMessage(
  threadUid: string,
  text: string,
  sender: AppUser
): Promise<void> {
  const body = text.trim();
  if (!body) return;
  if (body.length > CHAT_MAX_LENGTH) throw new AppError('chat.tooLong', 'invalid-argument');

  const fromAdmin = sender.role === 'admin';
  // A member writes only into their own thread. The rules refuse anything
  // else; this only says so before a round trip does.
  if (!fromAdmin && sender.uid !== threadUid) {
    throw new AppError('errors.permissionDenied', 'permission-denied');
  }

  const threadRef = doc(db, COLLECTIONS.chats, threadUid);
  const messageRef = doc(collection(threadRef, MESSAGES));
  const batch = writeBatch(db);

  batch.set(messageRef, {
    from: sender.uid,
    fromName: sender.fullName,
    fromAdmin,
    text: body,
    at: serverTimestamp(),
  });

  batch.set(
    threadRef,
    {
      uid: threadUid,
      // The member's name is refreshed by the member. An admin's reply leaves
      // it alone, so the inbox always names the person, not whoever wrote last.
      ...(fromAdmin ? {} : { userName: sender.fullName, userRole: sender.role }),
      lastMessage: body.slice(0, PREVIEW_LENGTH),
      lastFromAdmin: fromAdmin,
      lastAt: serverTimestamp(),
      // Whoever writes has read everything before it.
      ...(fromAdmin
        ? { unreadForAdmin: 0, unreadForUser: increment(1) }
        : { unreadForUser: 0, unreadForAdmin: increment(1) }),
    },
    { merge: true }
  );

  await batch.commit();
}

/** Opening a conversation is what clears its unread count, for that side only. */
export function markChatRead(threadUid: string, asAdmin: boolean): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.chats, threadUid), {
    [asAdmin ? 'unreadForAdmin' : 'unreadForUser']: 0,
  }).catch(() => undefined);
}

export function watchChatThread(
  threadUid: string,
  onNext: (thread: ChatThreadSummary | null) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    doc(db, COLLECTIONS.chats, threadUid),
    (snap) => onNext(snap.exists() ? read<ChatThreadSummary>(snap) : null),
    (error) => onError?.(error)
  );
}

/** The latest messages, oldest first, kept current. */
export function watchChatMessages(
  threadUid: string,
  onNext: (messages: ChatMessage[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    query(
      collection(db, COLLECTIONS.chats, threadUid, MESSAGES),
      orderBy('at', 'desc'),
      limit(MESSAGE_WINDOW)
    ),
    (snap) => onNext(snap.docs.map((d) => read<ChatMessage>(d)).reverse()),
    (error) => onError?.(error)
  );
}

/** Every conversation, most recent first. Admin only — the rules refuse anybody else. */
export function watchChatInbox(
  onNext: (threads: ChatThreadSummary[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    query(collection(db, COLLECTIONS.chats), orderBy('lastAt', 'desc'), limit(INBOX_SIZE)),
    (snap) => onNext(snap.docs.map((d) => read<ChatThreadSummary>(d))),
    (error) => onError?.(error)
  );
}

/**
 * How many messages are waiting for the admins, and who sent the latest.
 * Only threads with something unread are read, so a quiet inbox costs nothing.
 */
export function watchAdminUnread(
  onNext: (total: number, latest: ChatThreadSummary | null) => void
): () => void {
  return onSnapshot(
    query(collection(db, COLLECTIONS.chats), where('unreadForAdmin', '>', 0), limit(INBOX_SIZE)),
    (snap) => {
      const threads = snap.docs.map((d) => read<ChatThreadSummary>(d));
      const total = threads.reduce((sum, thread) => sum + (thread.unreadForAdmin ?? 0), 0);
      const latest =
        threads.sort(
          (a, b) => (asDate(b.lastAt)?.getTime() ?? 0) - (asDate(a.lastAt)?.getTime() ?? 0)
        )[0] ?? null;
      onNext(total, latest);
    },
    () => onNext(0, null)
  );
}
