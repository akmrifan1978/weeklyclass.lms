import { COLLECTIONS } from '@/constants/app';
import type { AppUser, LanguageCode, SeerahChapter } from '@/types';

import { createDoc, listAll, softDelete, updateDocById } from './firestore';
import * as audit from './auditService';

/**
 * The Seerah, as this organisation tells it.
 *
 * Every other Islamic section in the app ships with its content — the duʿāʾ
 * collection is a constant, the hadith come from a published dataset. This one
 * deliberately does not. The standard Seerah works are under copyright, and a
 * life of the Prophet ﷺ is not something to generate and present as fact, so
 * the words belong to whoever writes them here and the app only stores them.
 *
 * Chapters are ordered by an explicit number rather than by when they were
 * written, because the Seerah has an order of its own and somebody adding a
 * missed chapter later should be able to put it where it belongs.
 */

export function listChapters(options: {
  language?: LanguageCode;
  includeDrafts?: boolean;
} = {}): Promise<SeerahChapter[]> {
  return listAll<SeerahChapter>(COLLECTIONS.seerahChapters, {
    filters: [
      options.language ? ['language', '==', options.language] : null,
      options.includeDrafts ? null : ['status', '==', 'published'],
    ],
    orderByField: 'order',
    direction: 'asc',
    pageSize: 200,
  });
}

export async function saveChapter(
  data: Partial<SeerahChapter> & { title: string; body: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    order: data.order ?? 0,
    language: data.language ?? ('en' as LanguageCode),
    status: data.status ?? ('published' as const),
    ...data,
  };

  if (id) {
    await updateDocById<SeerahChapter>(COLLECTIONS.seerahChapters, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.seerahChapters,
      documentId: id,
      summary: `Updated Seerah chapter "${data.title}"`,
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.seerahChapters, payload, { actorId: actor.uid });
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.seerahChapters,
    documentId: newId,
    summary: `Added Seerah chapter "${data.title}"`,
  });
  return newId;
}

export async function deleteChapter(chapter: SeerahChapter, actor: AppUser): Promise<void> {
  // Soft, like the rest of the content. A chapter somebody spent an evening
  // writing should not vanish because a thumb landed on the wrong row.
  await softDelete(COLLECTIONS.seerahChapters, chapter.id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.seerahChapters,
    documentId: chapter.id,
    summary: `Removed Seerah chapter "${chapter.title}"`,
  });
}

/**
 * Groups chapters under their period, keeping the order they were given.
 *
 * A Map rather than an object: insertion order is the reading order, and an
 * object with numeric-looking keys would quietly reorder itself.
 */
export function groupByPeriod(chapters: SeerahChapter[]): Map<string, SeerahChapter[]> {
  const groups = new Map<string, SeerahChapter[]>();
  for (const chapter of chapters) {
    const key = chapter.period?.trim() || '';
    const existing = groups.get(key);
    if (existing) existing.push(chapter);
    else groups.set(key, [chapter]);
  }
  return groups;
}
