import { COLLECTIONS } from '@/constants/app';
import { mediaKindOf } from '@/utils/branding';
import type {
  Article,
  CalendarEvent,
  Flyer,
  KhutbahEntry,
  Lesson,
  Material,
  VideoItem,
} from '@/types';
import { listAll } from './firestore';
import { getSettings } from './settingsService';
import { videoPosterUrl } from './storageService';
import { autoThumbnail } from './videoService';

/**
 * Every image and video already uploaded or linked anywhere in the app.
 *
 * There is no separate media library to keep — the uploads already live on the
 * records they were made for: a recording's file and poster, a khutbah's
 * picture, a flyer, an event banner, a lesson's video. This gathers them, so an
 * admin building the app banner picks from what exists instead of uploading the
 * same file a second time.
 *
 * Read by an admin only, and bounded: a couple of hundred of each is far more
 * than a centre publishes, and every read here is a Firestore read.
 */

export interface MediaAsset {
  url: string;
  type: 'image' | 'video';
  /** What it belongs to, in words the admin will recognise. */
  label: string;
  /** Which part of the app it came from. An i18n key. */
  sourceKey: string;
  /** A picture to show in the picker. The image itself, or a video's still. */
  preview: string | null;
}

const LIMIT = 200;

function previewFor(url: string, type: 'image' | 'video'): string | null {
  if (type === 'image') return url;
  return videoPosterUrl(url) ?? autoThumbnail(url) ?? null;
}

export async function listUploadedMedia(): Promise<MediaAsset[]> {
  const found = new Map<string, MediaAsset>();

  const add = (
    url: string | null | undefined,
    label: string | null | undefined,
    sourceKey: string,
    expected?: 'image' | 'video'
  ) => {
    const clean = url?.trim();
    if (!clean || found.has(clean)) return;
    const type = expected ?? mediaKindOf(clean);
    if (!type) return;
    // A field that says it holds a video but whose address is plainly an
    // image, or the reverse, is trusted to its address.
    const detected = mediaKindOf(clean);
    const finalType = detected ?? type;
    found.set(clean, {
      url: clean,
      type: finalType,
      label: label?.trim() || '',
      sourceKey,
      preview: previewFor(clean, finalType),
    });
  };

  // Each one is allowed to fail on its own. A collection the rules refuse, or
  // one that does not exist yet, must not empty the whole picker.
  const [videos, khutbahs, flyers, events, articles, lessons, materials, settings] =
    await Promise.all([
      listAll<VideoItem>(COLLECTIONS.videos, { pageSize: LIMIT }).catch(() => []),
      listAll<KhutbahEntry>(COLLECTIONS.khutbahs, { pageSize: LIMIT }).catch(() => []),
      listAll<Flyer>(COLLECTIONS.flyers, { pageSize: LIMIT }).catch(() => []),
      listAll<CalendarEvent>(COLLECTIONS.calendarEvents, { pageSize: LIMIT }).catch(() => []),
      listAll<Article>(COLLECTIONS.articles, { pageSize: LIMIT }).catch(() => []),
      listAll<Lesson>(COLLECTIONS.lessons, { pageSize: LIMIT }).catch(() => []),
      listAll<Material>(COLLECTIONS.materials, { pageSize: LIMIT }).catch(() => []),
      getSettings(true).catch(() => null),
    ]);

  for (const v of videos) {
    add(v.videoUrl, v.title, 'media.fromRecordings', 'video');
    add(v.bannerUrl, v.title, 'media.fromRecordings', 'image');
    add(v.thumbnail, v.title, 'media.fromRecordings', 'image');
  }
  for (const k of khutbahs) {
    if (k.mediaType === 'video') add(k.mediaUrl, k.title, 'media.fromKhutbahs', 'video');
    add(k.imageUrl, k.title, 'media.fromKhutbahs', 'image');
  }
  for (const f of flyers) {
    if (f.fileType === 'image') add(f.fileUrl, f.description || f.title, 'media.fromFlyers', 'image');
  }
  for (const e of events) add(e.bannerUrl, e.title, 'media.fromEvents', 'image');
  for (const a of articles) add(a.image, a.title, 'media.fromArticles', 'image');
  for (const l of lessons) {
    add(l.videoUrl, l.title, 'media.fromLessons', 'video');
    add(l.imageUrl, l.title, 'media.fromLessons', 'image');
  }
  for (const m of materials) {
    if (m.type === 'image') add(m.url, m.title, 'media.fromMaterials', 'image');
  }
  if (settings) {
    add(settings.bannerUrl, null, 'media.fromSettings', 'image');
    add(settings.thumbnailUrl, null, 'media.fromSettings', 'image');
    add(settings.logoUrl, null, 'media.fromSettings', 'image');
  }

  return Array.from(found.values());
}
