import { Platform } from 'react-native';
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';

import { storage } from '@/firebase/config';
import { UPLOAD_LIMITS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import { formatBytes } from '@/utils/format';

/**
 * File uploads, with two backends.
 *
 * CLOUDINARY (preferred, and free) — used when EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME
 * and EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET are set. Firebase now requires a
 * billing account before Cloud Storage can be enabled at all, which leaves a
 * free project with no way to upload anything. Cloudinary's free tier is
 * generous (25 GB), needs no card, and its "unsigned upload preset" exists
 * precisely so a client can upload without a backend signing the request.
 *
 * FIREBASE STORAGE — used when Cloudinary is not configured. Works only on a
 * project where Storage has been enabled, i.e. a paid one.
 *
 * Either way, videos are never uploaded — only their URLs are stored, so a
 * class recording lives on YouTube at no cost.
 *
 * On the unsigned preset: the preset name ships in the app, so anyone who
 * extracts it could upload to that folder. Cloudinary presets can restrict
 * format, size and folder, which bounds the damage to junk files you can
 * delete. That trade is worth it here; the alternative is no uploads at all.
 * See docs/FIREBASE.md.
 */

export type UploadKind = 'avatar' | 'material' | 'thumbnail' | 'article' | 'branding';

/**
 * How long an upload may run before it is treated as stuck. Generous enough for
 * a large PDF on a weak connection, short enough that a misconfigured project
 * reports the problem instead of appearing to work forever.
 */
const UPLOAD_TIMEOUT_MS = 90_000;

const CLOUDINARY_CLOUD = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const CLOUDINARY_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

/** True when in-app uploading is actually possible, so the UI can say so. */
export function uploadsConfigured(): boolean {
  return Boolean(CLOUDINARY_CLOUD && CLOUDINARY_PRESET);
}

/**
 * Uploads through Cloudinary's unsigned endpoint.
 *
 * `auto` handles images and documents alike, so one path covers avatars,
 * branding and study materials. No SDK is involved — it is a single multipart
 * POST, which keeps the bundle small and avoids another dependency.
 */
async function uploadToCloudinary(params: {
  uri: string;
  fileName: string;
  kind: UploadKind;
  contentType: string;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`;

  const form = new FormData();
  // React Native's FormData takes this shape; on web the fetched blob is used.
  if (params.uri.startsWith('data:') || params.uri.startsWith('blob:') || Platform.OS === 'web') {
    const blob = await fetch(params.uri).then((r) => r.blob());
    form.append('file', blob, params.fileName);
  } else {
    form.append('file', {
      uri: params.uri,
      name: params.fileName,
      type: params.contentType,
    } as unknown as Blob);
  }
  form.append('upload_preset', CLOUDINARY_PRESET);
  form.append('folder', `weeklyclass/${params.kind}`);

  // Cloudinary gives no progress events over fetch. Report an indeterminate
  // midpoint so the button does not look frozen on a slow connection.
  params.onProgress?.(50);

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let payload: { secure_url?: string; bytes?: number; error?: { message?: string } };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    payload = await response.json();
  } catch (error) {
    throw (error as Error)?.name === 'AbortError'
      ? new AppError('errors.uploadTimedOut', 'cloudinary/timeout')
      : new AppError('errors.uploadFailed', 'cloudinary/network');
  } finally {
    clearTimeout(deadline);
  }

  if (!payload.secure_url) {
    console.error('[WeeklyClass] Cloudinary rejected the upload:', payload.error);
    throw new AppError('errors.uploadFailed', 'cloudinary/rejected');
  }

  params.onProgress?.(100);
  return {
    url: payload.secure_url,
    // Cloudinary is addressed by URL, not by a Storage path; nothing to delete
    // through storageService.remove().
    path: '',
    size: payload.bytes ?? 0,
    contentType: params.contentType,
  };
}

/**
 * Turns a Storage failure into something that says what to do about it. The
 * bucket-missing case matters most: it means Cloud Storage was never enabled on
 * the Firebase project, which is a one-click fix in the console but produces a
 * completely opaque failure until someone knows that.
 */
function describeUploadError(error: unknown): AppError {
  const code = (error as { code?: string })?.code ?? '';

  if (code === 'storage/unknown' || code === 'storage/bucket-not-found') {
    return new AppError('errors.storageNotSetUp', code);
  }
  if (code === 'storage/unauthorized') {
    return new AppError('errors.permissionDenied', code);
  }
  if (code === 'storage/quota-exceeded') {
    return new AppError('errors.quotaExceeded', code);
  }
  if (code === 'storage/canceled') {
    return new AppError('errors.uploadCancelled', code);
  }
  return new AppError('errors.uploadFailed', code || 'storage/unknown');
}

const LIMITS: Record<UploadKind, number> = {
  avatar: UPLOAD_LIMITS.imageBytes,
  thumbnail: UPLOAD_LIMITS.imageBytes,
  article: UPLOAD_LIMITS.imageBytes,
  branding: UPLOAD_LIMITS.imageBytes,
  material: UPLOAD_LIMITS.documentBytes,
};

export interface UploadResult {
  url: string;
  path: string;
  size: number;
  contentType: string;
}

function extensionFor(name: string, fallback: string): string {
  const match = name.match(/\.([A-Za-z0-9]{1,6})$/);
  return match?.[1]?.toLowerCase() ?? fallback;
}

/**
 * Storage paths mirror the access rules:
 *   avatars/{uid}/...           owner + admins
 *   materials/{classId}/...     class members + staff
 *   thumbnails|articles|branding/...  staff write, everyone read
 */
export function pathFor(kind: UploadKind, ownerId: string, fileName: string): string {
  const stamp = Date.now();
  const ext = extensionFor(fileName, kind === 'material' ? 'bin' : 'jpg');
  const safe = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w-]+/g, '-')
    .slice(0, 40)
    .toLowerCase();

  switch (kind) {
    case 'avatar':
      return `avatars/${ownerId}/${stamp}-${safe}.${ext}`;
    case 'material':
      return `materials/${ownerId}/${stamp}-${safe}.${ext}`;
    case 'thumbnail':
      return `thumbnails/${stamp}-${safe}.${ext}`;
    case 'article':
      return `articles/${stamp}-${safe}.${ext}`;
    case 'branding':
      return `branding/${stamp}-${safe}.${ext}`;
  }
}

/**
 * Uploads a local file (an `expo-image-picker` or `expo-document-picker` uri).
 * `onProgress` receives 0-100.
 */
export async function upload(params: {
  uri: string;
  fileName: string;
  kind: UploadKind;
  /** uid for avatars, classId for materials. */
  ownerId: string;
  contentType?: string;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  const contentType = params.contentType ?? 'application/octet-stream';

  // Cloudinary first when it is configured — it is the only path that works on
  // a free Firebase project.
  if (uploadsConfigured()) {
    return uploadToCloudinary({
      uri: params.uri,
      fileName: params.fileName,
      kind: params.kind,
      contentType,
      onProgress: params.onProgress,
    });
  }

  const response = await fetch(params.uri);
  const blob = await response.blob();

  const limit = LIMITS[params.kind];
  if (blob.size > limit) {
    throw new AppError(`errors.fileTooLarge|${formatBytes(limit)}`, 'storage/quota-exceeded');
  }

  const path = pathFor(params.kind, params.ownerId, params.fileName);
  const objectRef = ref(storage, path);

  const task = uploadBytesResumable(objectRef, blob, { contentType });

  await new Promise<void>((resolve, reject) => {
    // Without a deadline this can spin indefinitely. The common cause is that
    // Cloud Storage was never enabled on the project: the SDK keeps retrying a
    // bucket that does not exist, reports steady 0% progress, and never fails —
    // which looks exactly like a slow upload and is not one.
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const deadline = setTimeout(() => {
      finish(() => {
        task.cancel();
        reject(new AppError('errors.uploadTimedOut', 'storage/retry-limit-exceeded'));
      });
    }, UPLOAD_TIMEOUT_MS);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          params.onProgress?.(
            Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          );
        }
      },
      (error) => {
        clearTimeout(deadline);
        finish(() => reject(describeUploadError(error)));
      },
      () => {
        clearTimeout(deadline);
        finish(resolve);
      }
    );
  });

  const url = await getDownloadURL(objectRef);
  return { url, path, size: blob.size, contentType };
}

/** Deletes a stored object. Missing objects are not an error. */
export async function remove(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'storage/object-not-found') {
      console.warn('[storage] delete failed', error);
    }
  }
}

/** Maps a MIME type to the material type shown in the UI. */
export function materialTypeFor(
  contentType: string,
  fileName: string
): 'pdf' | 'audio' | 'image' | 'document' {
  const ext = extensionFor(fileName, '');
  if (contentType.includes('pdf') || ext === 'pdf') return 'pdf';
  if (contentType.startsWith('audio') || ['mp3', 'm4a', 'wav', 'ogg'].includes(ext)) return 'audio';
  if (contentType.startsWith('image') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext))
    return 'image';
  return 'document';
}
