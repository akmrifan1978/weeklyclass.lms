import { COLLECTIONS } from '@/constants/app';
import type { AppUser, Article, Lesson, Material } from '@/types';
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
import { announce } from './announceService';

/** Lessons, articles and study materials. */

// --- Lessons ---------------------------------------------------------------

export interface LessonQuery {
  classId?: string;
  teacherId?: string;
  status?: Lesson['status'];
  language?: string;
  cursor?: Cursor;
  pageSize?: number;
}

export function listLessons(options: LessonQuery = {}): Promise<Page<Lesson>> {
  return listPage<Lesson>(COLLECTIONS.lessons, {
    filters: [
      options.classId ? ['classId', '==', options.classId] : null,
      options.teacherId ? ['teacherId', '==', options.teacherId] : null,
      options.status ? ['status', '==', options.status] : null,
      options.language ? ['language', '==', options.language] : null,
    ],
    orderByField: 'weekNumber',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

/** Published lessons for the student's own class only. */
export function lessonsForStudent(classId: string, pageSize = 20): Promise<Page<Lesson>> {
  return listPage<Lesson>(COLLECTIONS.lessons, {
    filters: [
      ['classId', '==', classId],
      ['status', '==', 'published'],
    ],
    orderByField: 'weekNumber',
    direction: 'desc',
    pageSize,
  });
}

export function getLesson(id: string): Promise<Lesson | null> {
  return getById<Lesson>(COLLECTIONS.lessons, id);
}

export async function saveLesson(
  data: Partial<Lesson> & { title: string; classId: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    description: '',
    weekNumber: 1,
    language: 'en' as const,
    status: 'published' as const,
    ...data,
  };

  if (id) {
    const before = await getLesson(id);
    await updateDocById<Lesson>(COLLECTIONS.lessons, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.lessons,
      documentId: id,
      summary: `Updated lesson "${data.title}"`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        payload as unknown as Record<string, unknown>
      ),
    });
    void announce(
      {
        kind: 'lesson',
        title: payload.title,
        classId: payload.classId,
        published: payload.status === 'published',
        isUpdate: true,
      },
      actor
    );
    return id;
  }

  const newId = await createDoc(COLLECTIONS.lessons, payload, { actorId: actor.uid });

  // The class is told as soon as it is published. Fire-and-forget by design:
  // the lesson is saved either way, and a failed push must not undo it.
  void announce(
    {
      kind: 'lesson',
      title: payload.title,
      classId: payload.classId,
      published: payload.status === 'published',
    },
    actor
  );
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.lessons,
    documentId: newId,
    summary: `Added lesson "${data.title}"`,
  });
  return newId;
}

export async function deleteLesson(id: string, actor: AppUser): Promise<void> {
  const before = await getLesson(id);
  await softDelete(COLLECTIONS.lessons, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.lessons,
    documentId: id,
    summary: `Removed lesson "${before?.title ?? id}"`,
  });
}

// --- Articles --------------------------------------------------------------

export function listArticles(options: {
  status?: Article['status'];
  language?: string;
  cursor?: Cursor;
  pageSize?: number;
} = {}): Promise<Page<Article>> {
  return listPage<Article>(COLLECTIONS.articles, {
    filters: [
      options.status ? ['status', '==', options.status] : null,
      options.language ? ['language', '==', options.language] : null,
    ],
    orderByField: 'publishedAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

export async function getLatestArticle(language?: string): Promise<Article | null> {
  const featured = await listAll<Article>(COLLECTIONS.articles, {
    filters: [
      ['isFeatured', '==', true],
      ['status', '==', 'published'],
      language ? ['language', '==', language] : null,
    ],
    orderByField: 'publishedAt',
    direction: 'desc',
    pageSize: 1,
  });
  if (featured[0]) return featured[0];

  // No hand-picked article — fall back to the most recently published one.
  const latest = await listAll<Article>(COLLECTIONS.articles, {
    filters: [['status', '==', 'published'], language ? ['language', '==', language] : null],
    orderByField: 'publishedAt',
    direction: 'desc',
    pageSize: 1,
  });
  return latest[0] ?? null;
}

export function getArticle(id: string): Promise<Article | null> {
  return getById<Article>(COLLECTIONS.articles, id);
}

export async function saveArticle(
  data: Partial<Article> & { title: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    content: '',
    summary: '',
    author: actor.fullName,
    language: 'en' as const,
    status: 'published' as const,
    isFeatured: false,
    publishedAt: new Date(),
    ...data,
  };

  if (id) {
    const before = await getArticle(id);
    await updateDocById<Article>(COLLECTIONS.articles, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.articles,
      documentId: id,
      summary: `Updated article "${data.title}"`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        payload as unknown as Record<string, unknown>
      ),
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.articles, payload, { actorId: actor.uid });
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.articles,
    documentId: newId,
    summary: `Added article "${data.title}"`,
  });
  return newId;
}

export async function deleteArticle(id: string, actor: AppUser): Promise<void> {
  const before = await getArticle(id);
  await softDelete(COLLECTIONS.articles, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.articles,
    documentId: id,
    summary: `Removed article "${before?.title ?? id}"`,
  });
}

// --- Study materials -------------------------------------------------------

export function listMaterials(options: {
  classId?: string;
  lessonId?: string;
  type?: Material['type'];
  cursor?: Cursor;
  pageSize?: number;
} = {}): Promise<Page<Material>> {
  return listPage<Material>(COLLECTIONS.materials, {
    filters: [
      options.classId ? ['classId', '==', options.classId] : null,
      options.lessonId ? ['lessonId', '==', options.lessonId] : null,
      options.type ? ['type', '==', options.type] : null,
    ],
    orderByField: 'createdAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

/** Class materials plus materials shared with everyone. */
export async function materialsForStudent(
  classId: string | null | undefined,
  pageSize = 30
): Promise<Material[]> {
  const shared = listAll<Material>(COLLECTIONS.materials, {
    filters: [
      ['classId', '==', null],
      ['status', '==', 'published'],
    ],
    orderByField: 'createdAt',
    direction: 'desc',
    pageSize,
  });
  const mine = classId
    ? listAll<Material>(COLLECTIONS.materials, {
        filters: [
          ['classId', '==', classId],
          ['status', '==', 'published'],
        ],
        orderByField: 'createdAt',
        direction: 'desc',
        pageSize,
      })
    : Promise.resolve<Material[]>([]);

  const [a, b] = await Promise.all([shared, mine]);
  const merged = new Map<string, Material>();
  for (const item of [...a, ...b]) merged.set(item.id, item);
  return Array.from(merged.values()).slice(0, pageSize);
}

export function getMaterial(id: string): Promise<Material | null> {
  return getById<Material>(COLLECTIONS.materials, id);
}

export async function saveMaterial(
  data: Partial<Material> & { title: string; url: string; type: Material['type'] },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = { language: 'en' as const, status: 'published' as const, ...data };

  const tell = (isUpdate: boolean) =>
    void announce(
      {
        kind: 'material',
        title: payload.title,
        classId: payload.classId ?? null,
        published: payload.status === 'published',
        isUpdate,
      },
      actor
    );

  if (id) {
    await updateDocById<Material>(COLLECTIONS.materials, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.materials,
      documentId: id,
      summary: `Updated material "${data.title}"`,
    });
    tell(true);
    return id;
  }

  const newId = await createDoc(COLLECTIONS.materials, payload, { actorId: actor.uid });
  tell(false);
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.materials,
    documentId: newId,
    summary: `Added material "${data.title}"`,
  });
  return newId;
}

export async function deleteMaterial(id: string, actor: AppUser): Promise<void> {
  const before = await getMaterial(id);
  await softDelete(COLLECTIONS.materials, id, actor.uid);
  // The Storage object is removed by the caller (storageService.remove) so this
  // service stays free of Storage concerns.
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.materials,
    documentId: id,
    summary: `Removed material "${before?.title ?? id}"`,
  });
}
