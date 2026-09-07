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

export type UploadKind =
  | 'avatar'
  | 'material'
  | 'thumbnail'
  | 'article'
  | 'branding'
  | 'recording';

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
 * One multipart POST to Cloudinary, over XMLHttpRequest rather than fetch.
 *
 * XHR is used for exactly one reason: it reports upload progress and fetch does
 * not. That used to be papered over by claiming 50% and hoping, which is fine
 * for a 200 KB avatar and useless for a recorded lesson — the one upload where
 * somebody genuinely needs to know whether it is worth continuing to wait.
 *
 * It works the same on React Native, where a file is handed over as a
 * `{ uri, name, type }` part and the platform streams it from disk rather than
 * loading ninety megabytes into memory first.
 */
function postToCloudinary(params: {
  file: Blob | { uri: string; name: string; type: string };
  fileName: string;
  folder: string;
  resourceType: 'auto' | 'video';
  timeoutMs: number;
  onProgress?: (percent: number) => void;
}): Promise<CloudinaryResponse> {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${params.resourceType}/upload`;

  const form = new FormData();
  if (typeof Blob !== 'undefined' && params.file instanceof Blob) {
    form.append('file', params.file, params.fileName);
  } else {
    form.append('file', params.file as unknown as Blob);
  }
  form.append('upload_preset', CLOUDINARY_PRESET);
  form.append('folder', params.folder);

  return new Promise<CloudinaryResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', endpoint);
    request.timeout = params.timeoutMs;

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      // Held at 99 while bytes are still moving. The last percent belongs to
      // Cloudinary's own processing, and a bar that sits full through a long
      // transcode is a bar that looks broken.
      params.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    request.onload = () => {
      let payload: CloudinaryResponse;
      try {
        payload = JSON.parse(request.responseText) as CloudinaryResponse;
      } catch {
        reject(new AppError('errors.uploadFailed', 'cloudinary/unreadable'));
        return;
      }
      if (!payload.secure_url) {
        // Worth logging verbatim: an unsigned preset that has not been allowed
        // to accept video says exactly that, and no amount of retrying fixes it.
        console.error('[WeeklyClass] Cloudinary rejected the upload:', payload.error);
        reject(new AppError('errors.uploadFailed', 'cloudinary/rejected'));
        return;
      }
      params.onProgress?.(100);
      resolve(payload);
    };

    request.onerror = () => reject(new AppError('errors.uploadFailed', 'cloudinary/network'));
    request.ontimeout = () => reject(new AppError('errors.uploadTimedOut', 'cloudinary/timeout'));
    request.onabort = () => reject(new AppError('errors.uploadCancelled', 'cloudinary/abort'));

    request.send(form);
  });
}

interface CloudinaryResponse {
  secure_url?: string;
  public_id?: string;
  bytes?: number;
  duration?: number;
  error?: { message?: string };
}

/** The web takes a Blob; React Native takes the file's own uri. */
async function filePart(
  uri: string,
  fileName: string,
  contentType: string
): Promise<Blob | { uri: string; name: string; type: string }> {
  if (uri.startsWith('data:') || uri.startsWith('blob:') || Platform.OS === 'web') {
    return fetch(uri).then((r) => r.blob());
  }
  return { uri, name: fileName, type: contentType };
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
  const payload = await postToCloudinary({
    file: await filePart(params.uri, params.fileName, params.contentType),
    fileName: params.fileName,
    folder: `weeklyclass/${params.kind}`,
    resourceType: 'auto',
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onProgress: params.onProgress,
  });

  return {
    url: optimisedUrl(payload.secure_url as string, params.kind),
    // Cloudinary is addressed by URL, not by a Storage path; nothing to delete
    // through storageService.remove().
    path: '',
    publicId: payload.public_id ?? null,
    size: payload.bytes ?? 0,
    contentType: params.contentType,
  };
}

/**
 * How long a video upload may run.
 *
 * Far longer than the ninety seconds a document gets. Ninety megabytes over a
 * phone connection in a hall is a genuinely slow thing that is nonetheless
 * working, and cutting it off throws away a recording that cannot be made
 * again.
 */
const VIDEO_UPLOAD_TIMEOUT_MS = 20 * 60_000;

export interface VideoUploadResult extends UploadResult {
  /** Seconds, as Cloudinary measured it — more trustworthy than our own timer. */
  durationSeconds: number | null;
}

/**
 * Uploads a recorded lesson.
 *
 * Separate from `upload` because a video is not a document with a bigger number
 * attached. It goes to Cloudinary's `video` endpoint so the file is handled as
 * media — which is what later makes a poster frame and a format conversion
 * possible — and it never touches Firebase Storage, which on a free project
 * does not exist.
 *
 * The size is checked here rather than left to Cloudinary because Cloudinary
 * only refuses an oversized file after receiving all of it, and the end of a
 * long upload is the worst possible moment to learn that.
 */
export async function uploadVideo(params: {
  uri: string;
  fileName: string;
  ownerId: string;
  contentType: string;
  sizeBytes?: number;
  onProgress?: (percent: number) => void;
}): Promise<VideoUploadResult> {
  if (!uploadsConfigured()) {
    throw new AppError('errors.videoUploadUnavailable', 'cloudinary/not-configured');
  }
  if (params.sizeBytes && params.sizeBytes > UPLOAD_LIMITS.videoBytes) {
    throw new AppError(
      `errors.fileTooLarge|${formatBytes(UPLOAD_LIMITS.videoBytes)}`,
      'cloudinary/too-large'
    );
  }

  const payload = await postToCloudinary({
    file: await filePart(params.uri, params.fileName, params.contentType),
    fileName: params.fileName,
    folder: `weeklyclass/recordings/${params.ownerId}`,
    resourceType: 'video',
    timeoutMs: VIDEO_UPLOAD_TIMEOUT_MS,
    onProgress: params.onProgress,
  });

  return {
    url: playableUrl(payload.secure_url as string),
    path: '',
    publicId: payload.public_id ?? null,
    size: payload.bytes ?? params.sizeBytes ?? 0,
    contentType: params.contentType,
    durationSeconds: typeof payload.duration === 'number' ? payload.duration : null,
  };
}

/**
 * Asks Cloudinary to serve whichever format the viewer's browser can play.
 *
 * Not an optimisation — this is what makes a recording watchable at all. A
 * browser records in whatever format it supports, which is WebM in Chrome and
 * MP4 in Safari, and a WebM file handed to an iPhone plays as nothing at all.
 * `f_auto:video` has Cloudinary transcode per request and cache the result, so
 * one recording serves every student whatever it was made on.
 */
export function playableUrl(url: string): string {
  const marker = '/video/upload/';
  if (!url.includes('res.cloudinary.com') || !url.includes(marker)) return url;
  // Already carrying a transformation — leave it alone rather than stack another.
  if (/\/video\/upload\/[a-z]{1,3}_/.test(url)) return url;
  return url.replace(marker, `${marker}f_auto:video,q_auto/`);
}

/**
 * A still from a Cloudinary-hosted video, usable as a thumbnail.
 *
 * Costs nothing to make and nothing to store: it is the same asset addressed as
 * an image at a given second. Null for a video hosted anywhere else, where the
 * caller falls back to a picture somebody chose.
 */
export function videoPosterUrl(url: string, atSecond = 1): string | null {
  const marker = '/video/upload/';
  if (!url.includes('res.cloudinary.com') || !url.includes(marker)) return null;
  const [head, tail] = url.split(marker);
  const withoutTransform = tail.replace(/^[a-z]{1,3}_[^/]*\//, '');
  const withoutExtension = withoutTransform.replace(/\.[A-Za-z0-9]+$/, '');
  return `${head}${marker}so_${atSecond},c_fill,w_640,h_360,q_auto/${withoutExtension}.jpg`;
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
  recording: UPLOAD_LIMITS.videoBytes,
};

export interface UploadResult {
  url: string;
  path: string;
  /**
   * Cloudinary's own id for the asset, when that is where it went.
   *
   * Kept so a stored recording can be addressed again later — for a poster
   * frame, another format, or a deletion — without parsing it back out of a URL.
   */
  publicId?: string | null;
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
    case 'recording':
      return `recordings/${ownerId}/${stamp}-${safe}.${ext}`;
  }
}

/**
 * The longest edge an image is allowed to keep, per use.
 *
 * A phone camera produces something around 4000px wide and several megabytes.
 * None of these pictures is ever displayed larger than a phone screen, so the
 * extra pixels cost upload time, storage and the viewer's data allowance while
 * being visibly worth nothing.
 */
const MAX_EDGE: Record<UploadKind, number> = {
  avatar: 512,
  thumbnail: 900,
  article: 1600,
  branding: 1200,
  // Deliberately generous: a material may be a photographed page of a book, and
  // text stops being readable long before a photograph starts to look wrong.
  material: 2200,
  // Never applied — a recording is not an image and shrinkIfImage leaves it
  // alone. Present because the map must cover every kind.
  recording: 0,
};

/**
 * Shrinks an image before it is uploaded, and leaves everything else alone.
 *
 * This is why a 12 MB photograph no longer fails against a 3 MB limit: it is
 * resized down to something the app will actually display and re-encoded as
 * JPEG at 80%, which for a photograph is indistinguishable at these sizes and
 * usually an order of magnitude smaller.
 *
 * PDFs and other documents pass through untouched. Compressing one properly
 * means re-encoding the streams inside it, which needs a library far larger
 * than everything it would save, and a PDF re-encoded badly loses the text
 * layer that makes it searchable — a much worse outcome than a big file.
 *
 * Failure is not fatal. If the image cannot be read or manipulated, the
 * original is uploaded and the existing size limit judges it, exactly as
 * before.
 */
async function shrinkIfImage(
  uri: string,
  kind: UploadKind,
  contentType: string
): Promise<string> {
  if (!contentType.startsWith('image/')) return uri;
  // Vectors have no pixels to throw away, and rasterising one would be a loss.
  if (contentType === 'image/svg+xml') return uri;

  try {
    const ImageManipulator = await import('expo-image-manipulator');
    const context = ImageManipulator.ImageManipulator.manipulate(uri);
    // A single width bound preserves the aspect ratio, and expo-image-manipulator
    // will not enlarge a picture that is already smaller than the bound.
    context.resize({ width: MAX_EDGE[kind] });

    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    return uri;
  }
}

/**
 * Asks Cloudinary to serve a smaller version than it stores.
 *
 * `f_auto` picks WebP or AVIF when the viewer's browser takes it, `q_auto`
 * drops quality to the point just before the eye notices, and `c_limit` caps
 * the dimensions without ever enlarging. Together they typically halve what
 * goes over the wire again, on top of the resize above, and cost nothing —
 * Cloudinary does the work and keeps the original untouched behind the URL.
 *
 * Only image deliveries are rewritten. A PDF is served from the same host under
 * a path these parameters do not apply to, and injecting them would produce a
 * URL that fetches nothing.
 */
function optimisedUrl(url: string, kind: UploadKind): string {
  const marker = '/image/upload/';
  if (!url.includes('res.cloudinary.com') || !url.includes(marker)) return url;
  // Already carrying a transformation — leave it be rather than stack a second.
  if (/\/image\/upload\/[a-z]{1,3}_/.test(url)) return url;

  return url.replace(marker, `${marker}f_auto,q_auto,c_limit,w_${MAX_EDGE[kind]}/`);
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

  // Shrunk before anything else looks at it, so the size limit is applied to
  // what will actually be sent rather than to what came off the camera.
  const uri = await shrinkIfImage(params.uri, params.kind, contentType);

  // Cloudinary first when it is configured — it is the only path that works on
  // a free Firebase project.
  if (uploadsConfigured()) {
    return uploadToCloudinary({
      uri,
      fileName: params.fileName,
      kind: params.kind,
      contentType,
      onProgress: params.onProgress,
    });
  }

  const response = await fetch(uri);
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
  return { url, path, publicId: null, size: blob.size, contentType };
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
