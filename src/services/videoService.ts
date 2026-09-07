import {
  collection,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  doc,
} from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import type { AppUser, VideoItem, VideoKind } from '@/types';
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
import { announce } from './announceService';

/**
 * Videos and class recordings share a collection and are separated by `kind`.
 *
 * Only URLs and thumbnails are stored — never the media itself. A video may
 * live in Firebase Storage, on YouTube, on Vimeo, or anywhere else that serves
 * a playable URL, which keeps the project inside the free Storage quota.
 */

export interface VideoQuery {
  kind?: VideoKind;
  classId?: string;
  branchId?: string;
  language?: string;
  status?: VideoItem['status'];
  cursor?: Cursor;
  pageSize?: number;
}

export function listVideos(options: VideoQuery = {}): Promise<Page<VideoItem>> {
  return listPage<VideoItem>(COLLECTIONS.videos, {
    filters: [
      ['kind', '==', options.kind ?? 'video'],
      options.classId ? ['classId', '==', options.classId] : null,
      options.branchId ? ['branchId', '==', options.branchId] : null,
      options.language ? ['language', '==', options.language] : null,
      options.status ? ['status', '==', options.status] : null,
    ],
    orderByField: 'date',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

/**
 * What a guest may watch: published, shared with everybody, newest first.
 *
 * Every filter here is load-bearing rather than cosmetic. The rules allow a
 * signed-out read only for a document that is published, unscoped and not
 * deleted, so a query that asked for anything wider would be refused outright
 * rather than quietly trimmed.
 */
export function listPublicVideos(pageSize = 12): Promise<Page<VideoItem>> {
  return listPage<VideoItem>(COLLECTIONS.videos, {
    // Deliberately NOT filtered by kind. The library holds imported collections
    // under kinds this code does not enumerate — `noor` among them — and a
    // guest asking "what is new" means everything published and shared, not
    // whichever kinds happened to be named in a type when this was written.
    //
    // And deliberately NOT filtered by `classId == null`, though that is
    // exactly what the rule requires. Firestore refuses a list query that
    // filters a field against null when the rule reads `resource.data`, so
    // asking for it directly is denied outright. The rule still enforces it per
    // document, which means the failure direction is safe: if a class-scoped
    // video is ever published, this query starts being refused and a guest sees
    // nothing, rather than seeing something they should not. The filter below
    // keeps the client honest in the meantime.
    filters: [['status', '==', 'published']],
    orderByField: 'date',
    direction: 'desc',
    pageSize,
  }).then((page) => ({
    ...page,
    items: page.items.filter((item) => !item.classId),
  }));
}

/**
 * Videos a student can see: published items for their class plus items with no
 * class restriction. Firestore cannot OR across fields in one query, so this is
 * two small reads merged client-side.
 */
export async function listVideosForStudent(
  classId: string | null | undefined,
  kind: VideoKind = 'video',
  pageSize = 20
): Promise<VideoItem[]> {
  const result = await cached(`videos/${kind}/${classId ?? 'shared'}`, () =>
    fetchVideosForStudent(classId, kind, pageSize)
  );
  return result.data;
}

async function fetchVideosForStudent(
  classId: string | null | undefined,
  kind: VideoKind = 'video',
  pageSize = 20
): Promise<VideoItem[]> {
  const shared = listAll<VideoItem>(COLLECTIONS.videos, {
    filters: [
      ['kind', '==', kind],
      ['status', '==', 'published'],
      ['classId', '==', null],
    ],
    orderByField: 'date',
    direction: 'desc',
    pageSize,
  });

  const mine = classId
    ? listAll<VideoItem>(COLLECTIONS.videos, {
        filters: [
          ['kind', '==', kind],
          ['status', '==', 'published'],
          ['classId', '==', classId],
        ],
        orderByField: 'date',
        direction: 'desc',
        pageSize,
      })
    : Promise.resolve<VideoItem[]>([]);

  const [a, b] = await Promise.all([shared, mine]);
  return dedupeByDateDesc([...a, ...b]).slice(0, pageSize);
}

function dedupeByDateDesc(items: VideoItem[]): VideoItem[] {
  const seen = new Map<string, VideoItem>();
  for (const item of items) seen.set(item.id, item);
  return Array.from(seen.values()).sort((a, b) => {
    const at = a.date && 'seconds' in a.date ? a.date.seconds : 0;
    const bt = b.date && 'seconds' in b.date ? b.date.seconds : 0;
    return bt - at;
  });
}

export function getVideo(id: string): Promise<VideoItem | null> {
  return getById<VideoItem>(COLLECTIONS.videos, id);
}

/**
 * Anything broadcasting right now. A live class is the most time-sensitive thing
 * on the platform — it is only relevant while it is happening — so it outranks
 * the featured release on the home screen.
 */
export async function getLiveVideo(): Promise<VideoItem | null> {
  const items = await listAll<VideoItem>(COLLECTIONS.videos, {
    filters: [
      ['isLive', '==', true],
      ['status', '==', 'published'],
    ],
    orderByField: 'date',
    direction: 'desc',
    pageSize: 1,
  });
  return items[0] ?? null;
}

/** The single video promoted to the home screen, if any. */
export async function getFeaturedVideo(): Promise<VideoItem | null> {
  const items = await listAll<VideoItem>(COLLECTIONS.videos, {
    filters: [
      ['isFeatured', '==', true],
      ['status', '==', 'published'],
    ],
    orderByField: 'date',
    direction: 'desc',
    pageSize: 1,
  });
  return items[0] ?? null;
}

export async function saveVideo(
  data: Partial<VideoItem> & { title: string; videoUrl: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    kind: 'video' as VideoKind,
    language: 'en' as const,
    status: 'published' as const,
    isFeatured: false,
    ...data,
  };

  const tell = (isUpdate: boolean) =>
    void announce(
      {
        kind: 'video',
        title: payload.title,
        classId: payload.classId ?? null,
        published: payload.status === 'published',
        image: payload.thumbnail ?? null,
        isUpdate,
      },
      actor
    );

  if (id) {
    const before = await getVideo(id);
    await updateDocById<VideoItem>(COLLECTIONS.videos, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.videos,
      documentId: id,
      summary: `Updated video "${data.title}"`,
      changes: audit.diff(
        (before ?? {}) as unknown as Record<string, unknown>,
        payload as unknown as Record<string, unknown>
      ),
    });
    if (payload.isFeatured) await setFeatured(id, actor);
    tell(true);
    return id;
  }

  const newId = await createDoc(COLLECTIONS.videos, payload, { actorId: actor.uid });
  tell(false);
  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.videos,
    documentId: newId,
    summary: `Added ${payload.kind} "${data.title}"`,
  });
  if (payload.isFeatured) await setFeatured(newId, actor);
  return newId;
}

/**
 * Promotes one video and demotes every other. Runs as a batch so the home
 * screen never shows two "new release" cards, even mid-update.
 */
export async function setFeatured(id: string, actor: AppUser): Promise<void> {
  const currentlyFeatured = await getDocs(
    query(
      collection(db, COLLECTIONS.videos),
      where('isFeatured', '==', true),
      where('deleted', '==', false),
      limit(10)
    )
  );

  const batch = writeBatch(db);
  for (const snap of currentlyFeatured.docs) {
    if (snap.id !== id) batch.update(snap.ref, { isFeatured: false });
  }
  batch.update(doc(db, COLLECTIONS.videos, id), { isFeatured: true });
  await batch.commit();

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.videos,
    documentId: id,
    summary: 'Set as featured video',
  });
}

export async function clearFeatured(id: string, actor: AppUser): Promise<void> {
  await updateDocById<VideoItem>(COLLECTIONS.videos, id, { isFeatured: false });
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.videos,
    documentId: id,
    summary: 'Removed from featured',
  });
}

export async function deleteVideo(id: string, actor: AppUser): Promise<void> {
  const before = await getVideo(id);
  await softDelete(COLLECTIONS.videos, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.videos,
    documentId: id,
    summary: `Removed video "${before?.title ?? id}"`,
  });
}

/**
 * Turns a share URL into something embeddable.
 * Returns `null` when the URL is a direct media file that a player can take
 * as-is.
 */
export function embedUrl(url: string): string | null {
  const youtube = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  if (youtube?.[1]) return `https://www.youtube.com/embed/${youtube[1]}?rel=0&playsinline=1`;

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo?.[1]) return `https://player.vimeo.com/video/${vimeo[1]}`;

  return null;
}

/**
 * Best-effort thumbnail when the author did not upload one: YouTube publishes a
 * still for every video, so a pasted YouTube link needs no image at all.
 * `fallback` is the organisation's default from Settings, used when even that is
 * unavailable — so a card is never blank.
 */
export function autoThumbnail(url: string, fallback?: string | null): string | null {
  const youtube = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  if (youtube?.[1]) return `https://img.youtube.com/vi/${youtube[1]}/hqdefault.jpg`;
  return fallback || null;
}
