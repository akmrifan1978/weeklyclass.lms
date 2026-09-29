import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  serverTimestamp,
  onSnapshot,
  getCountFromServer,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type WhereFilterOp,
} from 'firebase/firestore';

import { db } from '@/firebase/config';
import { denialContext } from '@/utils/errors';
import { PAGE_SIZE } from '@/constants/app';
import type { BaseDoc } from '@/types';

/**
 * Thin, typed wrapper over Firestore.
 *
 * Every read is bounded — there is no "fetch the whole collection" helper — so
 * a branch with 5,000 students costs the same as one with 20.
 */

export type Cursor = QueryDocumentSnapshot<DocumentData> | null;

export interface Page<T> {
  items: T[];
  cursor: Cursor;
  hasMore: boolean;
}

export interface ListOptions {
  /** `[field, op, value]` triples. Falsy entries are skipped. */
  filters?: ([string, WhereFilterOp, unknown] | null | false | undefined)[];
  orderByField?: string;
  direction?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: Cursor;
  /** Set false to include soft-deleted records (admin views). */
  excludeDeleted?: boolean;
}

function withId<T extends BaseDoc>(snap: DocumentSnapshot<DocumentData>): T {
  return { id: snap.id, ...(snap.data() as object) } as T;
}

function buildConstraints(options: ListOptions): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  for (const filter of options.filters ?? []) {
    if (!filter) continue;
    const [field, op, value] = filter;
    if (value === undefined) continue;
    constraints.push(where(field, op, value));
  }
  if (options.excludeDeleted !== false) {
    constraints.push(where('deleted', '==', false));
  }
  if (options.orderByField) {
    constraints.push(orderBy(options.orderByField, options.direction ?? 'desc'));
  }
  if (options.cursor) constraints.push(startAfter(options.cursor));
  constraints.push(fsLimit((options.pageSize ?? PAGE_SIZE) + 1));
  return constraints;
}

/**
 * A THIRTY-SECOND MEMORY OF WHAT EACH QUERY JUST RETURNED.
 *
 * `getDocs` never reads the local cache: every call goes to the server and is
 * billed one read per document returned. Every list screen refetches when it
 * mounts, so a student walking Home -> Lessons -> Home paid for the same
 * documents three times, and Firestore's free plan allows fifty thousand reads
 * a day for everybody in the centre together. The evening this was written they
 * ran out seven hours after the daily reset and every screen in the app showed
 * an error - which reached the admin dashboard as "storage limit reached".
 *
 * WHAT KEEPS IT HONEST, because a stale list is a worse bug than a slow one:
 *
 *   - Any write to a collection forgets what was remembered about it, so "save
 *     it and see it in the list" still works. That is the behaviour a cache
 *     like this breaks first, and the reason the write helpers below all call
 *     `forgetCollection`.
 *   - Pull to refresh clears the whole cache before it reloads, so asking for
 *     fresh data always gets it (see `useAsync`).
 *   - Thirty seconds, in memory only. Nothing survives a reload, and signing
 *     out empties it so the next person never sees the last one's data.
 *   - A live listener (`watchList`) is not affected by any of this. Those
 *     already serve from Firestore's own cache and are billed only for what
 *     changed.
 */
const CACHE_MS = 30_000;

const pageCache = new Map<string, { at: number; page: Page<BaseDoc> }>();

/**
 * Dates are rounded to the minute so that "events from now onwards", whose
 * filter value differs by milliseconds on every call, is still the same
 * question. Anything else is compared as it is written.
 */
function cacheKey(path: string, options: ListOptions): string {
  const parts = (options.filters ?? []).map((filter) => {
    if (!filter) return '';
    const [field, op, value] = filter;
    const stamp =
      value instanceof Date ? `d${Math.floor(value.getTime() / 60_000)}` : JSON.stringify(value);
    return `${field}${op}${stamp}`;
  });
  return [
    path,
    parts.join('|'),
    options.orderByField ?? '',
    options.direction ?? '',
    options.pageSize ?? PAGE_SIZE,
    options.excludeDeleted === false ? 'all' : 'live',
    // A page beyond the first is identified by the document it starts after.
    options.cursor?.id ?? '',
  ].join('~');
}

/** Drops what was remembered about one collection. Called by every write. */
export function forgetCollection(path: string): void {
  const prefix = `${path}~`;
  for (const key of pageCache.keys()) {
    if (key.startsWith(prefix)) pageCache.delete(key);
  }
}

/** Empties the cache: pull to refresh, and signing out. */
export function clearQueryCache(): void {
  pageCache.clear();
}

/** Fetches one page. Requests `pageSize + 1` docs to detect `hasMore` cheaply. */
export async function listPage<T extends BaseDoc>(
  path: string,
  options: ListOptions = {}
): Promise<Page<T>> {
  const pageSize = options.pageSize ?? PAGE_SIZE;

  const key = cacheKey(path, options);
  const remembered = pageCache.get(key);
  if (remembered && Date.now() - remembered.at < CACHE_MS) {
    return remembered.page as Page<T>;
  }

  const snap = await getDocs(query(collection(db, path), ...buildConstraints(options)));
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const visible = hasMore ? docs.slice(0, pageSize) : docs;
  const page: Page<T> = {
    items: visible.map((d) => withId<T>(d)),
    cursor: visible.length ? (visible[visible.length - 1] as QueryDocumentSnapshot) : null,
    hasMore,
  };
  pageCache.set(key, { at: Date.now(), page: page as Page<BaseDoc> });
  return page;
}

/** Convenience for small, bounded reads (dashboard cards, pickers). */
export async function listAll<T extends BaseDoc>(
  path: string,
  options: ListOptions = {}
): Promise<T[]> {
  const page = await listPage<T>(path, { ...options, pageSize: options.pageSize ?? 100 });
  return page.items;
}

export async function getById<T extends BaseDoc>(path: string, id: string): Promise<T | null> {
  if (!id) return null;
  const snap = await getDoc(doc(db, path, id));
  return snap.exists() ? withId<T>(snap) : null;
}

/** Realtime subscription for a single document. */
export function watchDoc<T extends BaseDoc>(
  path: string,
  id: string,
  onNext: (value: T | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, path, id),
    (snap) => onNext(snap.exists() ? withId<T>(snap) : null),
    (error) => onError?.(error)
  );
}

/** Realtime subscription for a bounded query. */
export function watchList<T extends BaseDoc>(
  path: string,
  options: ListOptions,
  onNext: (items: T[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(db, path), ...buildConstraints(options)),
    (snap) => {
      const pageSize = options.pageSize ?? PAGE_SIZE;
      onNext(snap.docs.slice(0, pageSize).map((d) => withId<T>(d)));
    },
    (error) => onError?.(error)
  );
}

export interface WriteMeta {
  /** uid of the acting user, stored on `createdBy`. */
  actorId?: string;
}

/** Creates a document with an auto id and the standard metadata fields. */
export async function createDoc<T extends object>(
  path: string,
  data: T,
  meta: WriteMeta = {}
): Promise<string> {
  const ref = await denialContext('create', path, () =>
    addDoc(collection(db, path), {
      ...stripUndefined(data),
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: meta.actorId ?? null,
    })
  );
  forgetCollection(path);
  return ref.id;
}

/** Creates or replaces a document at a known id. */
export async function setDocById<T extends object>(
  path: string,
  id: string,
  data: T,
  meta: WriteMeta = {},
  merge = true
): Promise<void> {
  await denialContext('write', `${path}/${id}`, () =>
    setDoc(
      doc(db, path, id),
      {
        ...stripUndefined(data),
        deleted: false,
        updatedAt: serverTimestamp(),
        ...(merge ? {} : { createdAt: serverTimestamp(), createdBy: meta.actorId ?? null }),
      },
      { merge }
    )
  );
  forgetCollection(path);
}

export async function updateDocById<T extends object>(
  path: string,
  id: string,
  data: Partial<T>
): Promise<void> {
  await denialContext('update', `${path}/${id}`, () =>
    updateDoc(doc(db, path, id), {
      ...stripUndefined(data),
      updatedAt: serverTimestamp(),
    })
  );
  forgetCollection(path);
}

/**
 * Soft delete — the default for anything a person created. The record stays
 * queryable by admins and keeps referential integrity for results/attendance.
 */
export async function softDelete(path: string, id: string, actorId?: string): Promise<void> {
  await denialContext('delete', `${path}/${id}`, () =>
    updateDoc(doc(db, path, id), {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: actorId ?? null,
      updatedAt: serverTimestamp(),
    })
  );
  forgetCollection(path);
}

export async function restore(path: string, id: string): Promise<void> {
  await updateDoc(doc(db, path, id), {
    deleted: false,
    deletedAt: null,
    deletedBy: null,
    updatedAt: serverTimestamp(),
  });
  forgetCollection(path);
}

/** Permanent removal. Reserved for admin "purge" actions and cleanup jobs. */
export async function hardDelete(path: string, id: string): Promise<void> {
  await denialContext('delete', `${path}/${id}`, () => deleteDoc(doc(db, path, id)));
  forgetCollection(path);
}

/** Server-side count — one billed read per 1,000 documents, not per document. */
export async function countWhere(
  path: string,
  filters: ([string, WhereFilterOp, unknown] | null | false | undefined)[] = [],
  includeDeleted = false
): Promise<number> {
  const constraints: QueryConstraint[] = [];
  for (const filter of filters) {
    if (!filter) continue;
    const [field, op, value] = filter;
    if (value === undefined) continue;
    constraints.push(where(field, op, value));
  }
  if (!includeDeleted) constraints.push(where('deleted', '==', false));
  const snap = await getCountFromServer(query(collection(db, path), ...constraints));
  return snap.data().count;
}

/** Applies many writes atomically. Firestore caps a batch at 500 operations. */
export async function batchWrite(
  operations: {
    type: 'set' | 'update' | 'delete';
    path: string;
    id: string;
    data?: DocumentData;
  }[]
): Promise<void> {
  const chunks: (typeof operations)[] = [];
  for (let i = 0; i < operations.length; i += 450) {
    chunks.push(operations.slice(i, i + 450));
  }
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, op.path, op.id);
      if (op.type === 'delete') batch.delete(ref);
      else if (op.type === 'update')
        batch.update(ref, { ...stripUndefined(op.data ?? {}), updatedAt: serverTimestamp() });
      else
        batch.set(
          ref,
          {
            ...stripUndefined(op.data ?? {}),
            deleted: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
    }
    await batch.commit();
  }
  for (const path of new Set(operations.map((op) => op.path))) forgetCollection(path);
}

/** Collection-group read, used for quiz questions across all quizzes. */
export async function listGroup<T extends BaseDoc>(
  groupId: string,
  options: ListOptions = {}
): Promise<T[]> {
  const snap = await getDocs(query(collectionGroup(db, groupId), ...buildConstraints(options)));
  return snap.docs.map((d) => withId<T>(d));
}

/**
 * Firestore rejects `undefined`. Callers routinely build objects with optional
 * fields, so strip them rather than making every call site defensive.
 */
export function stripUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) out[key] = val;
  }
  return out as T;
}

export { serverTimestamp, collection, doc, where, orderBy };
