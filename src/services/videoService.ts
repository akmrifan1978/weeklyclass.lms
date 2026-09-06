import {
  collection,
  deleteField,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  doc,
} from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type {
  AppUser,
  LanguageCode,
  TranslationEntry,
  VideoItem,
  VideoKind,
} from '@/types';
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

// ---------------------------------------------------------------------------
// Translation review
// ---------------------------------------------------------------------------

/**
 * The pipeline for translating Islamic content:
 *
 *   Arabic original → someone writes a translation → an admin reviews it →
 *   it is published
 *
 * Nothing skips a step. A draft is never shown to a reader, and only an admin
 * moves one to `approved` — because a fatwa translation carries the weight of
 * the ruling it renders, and publishing one nobody qualified has read is the
 * failure this whole design exists to prevent.
 *
 * The Arabic is never touched by any of this. These functions write only inside
 * `translations`, and no path here can alter `title` or `description`.
 */

/** Saves or updates one language's draft. Never publishes it. */
export async function saveTranslation(
  videoId: string,
  language: LanguageCode,
  entry: { title?: string; summary?: string },
  actor: AppUser
): Promise<void> {
  const existing = await getVideo(videoId);
  const current = existing?.translations?.[language];

  await updateDocById<VideoItem>(COLLECTIONS.videos, videoId, {
    [`translations.${language}`]: {
      title: entry.title?.trim() ?? '',
      summary: entry.summary?.trim() ?? '',
      // Editing an approved translation sends it back to draft. A reviewer
      // approved particular words; changing them afterwards without another
      // look would let anything through under someone else's approval.
      status: 'draft' as const,
      translatedBy: actor.uid,
      translatedByName: actor.fullName,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      updatedAt: new Date(),
    },
  } as unknown as Partial<VideoItem>);

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.videos,
    documentId: videoId,
    summary: `${current ? 'Updated' : 'Added'} ${language} translation draft`,
  });
}

/**
 * Publishes a translation. Admin only.
 *
 * Enforced here and in the audit trail rather than in the security rules:
 * `translations` is a nested map, and a rule that reliably diffs one language's
 * status inside it would be considerably harder to read than it is worth. The
 * screen offers the action to admins alone, every approval is logged with who
 * did it, and the Arabic is unreachable from this path either way.
 */
export async function approveTranslation(
  videoId: string,
  language: LanguageCode,
  actor: AppUser
): Promise<void> {
  if (actor.role !== 'admin') {
    throw new AppError('translation.adminOnly', 'permission-denied');
  }

  const existing = await getVideo(videoId);
  const entry = existing?.translations?.[language];
  if (!entry) throw new AppError('translation.nothingToApprove', 'not-found');

  await updateDocById<VideoItem>(COLLECTIONS.videos, videoId, {
    [`translations.${language}`]: {
      ...entry,
      status: 'approved' as const,
      reviewedBy: actor.uid,
      reviewedByName: actor.fullName,
      reviewedAt: new Date(),
    },
  } as unknown as Partial<VideoItem>);

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.videos,
    documentId: videoId,
    summary: `Approved the ${language} translation`,
  });
}

/** Withdraws a published translation without deleting the words. */
export async function unapproveTranslation(
  videoId: string,
  language: LanguageCode,
  actor: AppUser
): Promise<void> {
  if (actor.role !== 'admin') {
    throw new AppError('translation.adminOnly', 'permission-denied');
  }
  const existing = await getVideo(videoId);
  const entry = existing?.translations?.[language];
  if (!entry) return;

  await updateDocById<VideoItem>(COLLECTIONS.videos, videoId, {
    [`translations.${language}`]: { ...entry, status: 'draft' as const },
  } as unknown as Partial<VideoItem>);

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.videos,
    documentId: videoId,
    summary: `Withdrew the ${language} translation from publication`,
  });
}

export async function removeTranslation(
  videoId: string,
  language: LanguageCode,
  actor: AppUser
): Promise<void> {
  await updateDocById<VideoItem>(COLLECTIONS.videos, videoId, {
    [`translations.${language}`]: deleteField(),
  } as unknown as Partial<VideoItem>);

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.videos,
    documentId: videoId,
    summary: `Removed the ${language} translation`,
  });
}

/** The translation a READER should see: approved, or nothing at all. */
export function publishedTranslation(
  video: VideoItem,
  language: LanguageCode
): TranslationEntry | null {
  const entry = video.translations?.[language];
  return entry && entry.status === 'approved' ? entry : null;
}
