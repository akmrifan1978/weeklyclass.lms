import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { audienceFields, keysForUser, type Audience } from '@/types/audience';
import type { AppUser, ContentStatus, Workbook, WorkbookPage } from '@/types';
import {
  createDoc,
  getById,
  listPage,
  softDelete,
  updateDocById,
  watchList,
  type Page,
} from './firestore';
import * as audit from './auditService';
import { announce } from './announceService';

/**
 * Workbooks — a teacher's handwritten pages, given to students.
 *
 *   workbooks/{id}              title, date, audience, status
 *   workbooks/{id}/pages/{pid}  one page of strokes
 *
 * The split is not tidiness. A page of handwriting runs to tens of kilobytes
 * and a Firestore document stops at a megabyte, so a workbook of any length
 * cannot be one document — and a student opening the first page should not
 * have to download the twentieth to see it.
 *
 * DRAFT BY DEFAULT, always. A teacher writing during a lesson is mid-thought,
 * and a half-finished page appearing on thirty phones is not a mistake anyone
 * can take back. Nothing reaches a student until `publish` is called.
 */

const pagesPath = (workbookId: string) => `${COLLECTIONS.workbooks}/${workbookId}/pages`;

/** Today, as `YYYY-MM-DD` in the device's own timezone. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // Deliberately not toISOString(): that converts to UTC, so a workbook made
  // at nine in the evening in Jeddah would be dated tomorrow.
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// --- Reading ---------------------------------------------------------------

/** Everything one teacher has written, newest first. Drafts included. */
export function listMine(user: AppUser, pageSize = 50): Promise<Page<Workbook>> {
  return listPage<Workbook>(COLLECTIONS.workbooks, {
    filters: [['authorId', '==', user.uid]],
    orderByField: 'date',
    direction: 'desc',
    pageSize,
  });
}

/** Everything, for an admin. Drafts included, whoever wrote them. */
export function listAllWorkbooks(pageSize = 100): Promise<Page<Workbook>> {
  return listPage<Workbook>(COLLECTIONS.workbooks, {
    orderByField: 'date',
    direction: 'desc',
    pageSize,
  });
}

/**
 * The workbooks published to this student.
 *
 * One query, not three. The audience was flattened into `audienceKeys` when it
 * was saved precisely so that "everyone, or my class, or me by name" is a
 * single `array-contains-any` — see types/audience.ts.
 */
export function watchForStudent(
  user: AppUser,
  onNext: (workbooks: Workbook[]) => void,
  onError?: (error: unknown) => void,
  pageSize = 60
): Unsubscribe {
  return watchList<Workbook>(
    COLLECTIONS.workbooks,
    {
      filters: [
        ['status', '==', 'published'],
        ['audienceKeys', 'array-contains-any', keysForUser(user)],
      ],
      orderByField: 'date',
      direction: 'desc',
      pageSize,
    },
    onNext,
    onError
  );
}

export function getWorkbook(id: string): Promise<Workbook | null> {
  return getById<Workbook>(COLLECTIONS.workbooks, id);
}

/** The pages of one workbook, in order. */
export async function listPages(workbookId: string): Promise<WorkbookPage[]> {
  const snap = await getDocs(
    query(
      collection(db, pagesPath(workbookId)),
      where('deleted', '==', false),
      orderBy('order', 'asc')
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as WorkbookPage);
}

// --- Writing ---------------------------------------------------------------

export interface WorkbookInput {
  title: string;
  body?: string;
  audience: Audience;
  attachments?: { name: string; url: string }[];
  fromNoteId?: string | null;
}

/**
 * Creates a workbook. Always a draft, always dated today.
 *
 * The date is stamped here and never rewritten. A lesson belongs to the day it
 * was taught, and correcting a spelling a week later does not move it.
 */
export async function createWorkbook(input: WorkbookInput, user: AppUser): Promise<string> {
  const id = await createDoc(
    COLLECTIONS.workbooks,
    {
      title: input.title.trim() || today(),
      body: input.body?.trim() ?? '',
      authorId: user.uid,
      authorName: user.fullName,
      authorRole: user.role,
      date: today(),
      status: 'draft' as ContentStatus,
      publishedAt: null,
      pageCount: 0,
      fromNoteId: input.fromNoteId ?? null,
      attachments: input.attachments ?? [],
      ...audienceFields(input.audience),
    },
    { actorId: user.uid }
  );

  void audit.log({
    actor: user,
    action: 'CREATE',
    collection: COLLECTIONS.workbooks,
    documentId: id,
    summary: `Started workbook ${input.title || today()}`,
  });
  return id;
}

export async function updateWorkbook(
  id: string,
  changes: Partial<WorkbookInput> & { status?: ContentStatus; pageCount?: number },
  user: AppUser
): Promise<void> {
  const payload: Partial<Workbook> = {};
  if (changes.title !== undefined) payload.title = changes.title.trim();
  if (changes.body !== undefined) payload.body = changes.body.trim();
  if (changes.attachments !== undefined) payload.attachments = changes.attachments;
  if (changes.pageCount !== undefined) payload.pageCount = changes.pageCount;
  if (changes.status !== undefined) payload.status = changes.status;
  if (changes.audience) Object.assign(payload, audienceFields(changes.audience));

  await updateDocById<Workbook>(COLLECTIONS.workbooks, id, payload);
  void audit.log({
    actor: user,
    action: 'UPDATE',
    collection: COLLECTIONS.workbooks,
    documentId: id,
    summary: `Updated workbook ${changes.title ?? id}`,
  });
}

/**
 * Hands it to the students.
 *
 * The audience is re-written at this moment rather than trusted from whenever
 * the draft was started: a teacher who changed their mind about who it is for
 * did so on the form they are looking at now.
 */
export async function publish(
  workbook: Workbook,
  audience: Audience,
  user: AppUser
): Promise<void> {
  await updateDocById<Workbook>(COLLECTIONS.workbooks, workbook.id, {
    status: 'published',
    publishedAt: new Date(),
    ...audienceFields(audience),
  });

  void audit.log({
    actor: user,
    action: 'UPDATE',
    collection: COLLECTIONS.workbooks,
    documentId: workbook.id,
    summary: `Published workbook ${workbook.title}`,
  });

  // Announced only to the class when it went to one. A centre-wide alert for a
  // page meant for eight students is noise for everybody else.
  void announce(
    {
      kind: 'material',
      title: workbook.title,
      classId: audience.mode === 'classes' ? (audience.classIds?.[0] ?? null) : null,
      route: '/(student)/workbooks',
    },
    user
  );
}

export async function unpublish(workbook: Workbook, user: AppUser): Promise<void> {
  await updateDocById<Workbook>(COLLECTIONS.workbooks, workbook.id, { status: 'draft' });
  void audit.log({
    actor: user,
    action: 'UPDATE',
    collection: COLLECTIONS.workbooks,
    documentId: workbook.id,
    summary: `Took workbook ${workbook.title} back to draft`,
  });
}

/**
 * Soft delete, like everything else somebody made.
 *
 * The pages are left where they are. They are unreachable once the workbook is
 * gone, they cost nothing, and a deletion by a mistimed tap is recoverable for
 * as long as they survive.
 */
export async function deleteWorkbook(workbook: Workbook, user: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.workbooks, workbook.id, user.uid);
  void audit.log({
    actor: user,
    action: 'DELETE',
    collection: COLLECTIONS.workbooks,
    documentId: workbook.id,
    summary: `Deleted workbook ${workbook.title}`,
  });
}

// --- Pages -----------------------------------------------------------------

/**
 * Writes one page.
 *
 * `setDoc` at a known id rather than an add, so saving the same page twice
 * overwrites rather than duplicating — which is what a save button pressed
 * twice on a slow connection would otherwise do.
 */
export async function savePage(
  workbookId: string,
  page: { id?: string; order: number; strokes: string; text?: string; backgroundUrl?: string | null }
): Promise<string> {
  const id = page.id ?? doc(collection(db, pagesPath(workbookId))).id;
  await setDoc(
    doc(db, pagesPath(workbookId), id),
    {
      workbookId,
      order: page.order,
      strokes: page.strokes,
      text: page.text ?? '',
      backgroundUrl: page.backgroundUrl ?? null,
      deleted: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return id;
}

/**
 * Removes a page for good.
 *
 * The one hard delete here. A soft-deleted page still occupies its place in
 * the order, and leaving gaps in a book somebody is reading page by page is
 * worse than losing a page they asked to lose.
 */
export async function deletePage(workbookId: string, pageId: string): Promise<void> {
  await deleteDoc(doc(db, pagesPath(workbookId), pageId));
}

/**
 * Turns a private note into a workbook.
 *
 * The note is left exactly where it is. It is the teacher's own, the rules
 * keep it that way, and somebody who shares a thought should not find the
 * original has left their notebook.
 */
export async function fromNote(
  note: { id: string; title: string; body: string },
  audience: Audience,
  user: AppUser
): Promise<string> {
  return createWorkbook(
    {
      title: note.title.trim() || today(),
      body: note.body,
      audience,
      fromNoteId: note.id,
    },
    user
  );
}
