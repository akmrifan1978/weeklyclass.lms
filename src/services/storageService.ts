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
 * Firebase Storage uploads.
 *
 * The Spark plan gives 5 GB of storage and 1 GB/day of downloads, so:
 *  - file sizes are capped before upload (see UPLOAD_LIMITS),
 *  - videos are never uploaded — only their URLs are stored, so a class
 *    recording can live on YouTube/Vimeo at no cost,
 *  - every object is written under a predictable path so the security rules can
 *    reason about who owns it.
 */

export type UploadKind = 'avatar' | 'material' | 'thumbnail' | 'article' | 'branding';

/**
 * How long an upload may run before it is treated as stuck. Generous enough for
 * a large PDF on a weak connection, short enough that a misconfigured project
 * reports the problem instead of appearing to work forever.
 */
const UPLOAD_TIMEOUT_MS = 90_000;

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
  const response = await fetch(params.uri);
  const blob = await response.blob();

  const limit = LIMITS[params.kind];
  if (blob.size > limit) {
    throw new AppError(`errors.fileTooLarge|${formatBytes(limit)}`, 'storage/quota-exceeded');
  }

  const path = pathFor(params.kind, params.ownerId, params.fileName);
  const objectRef = ref(storage, path);
  const contentType = params.contentType ?? blob.type ?? 'application/octet-stream';

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
