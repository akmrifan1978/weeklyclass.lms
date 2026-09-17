import type { ImageStyle } from 'react-native';

import type { AppSettings, BannerItem, LogoShape, QaScholar } from '@/types';

/**
 * Branding helpers shared by every place the logo, the banner or the list of
 * Mowlavis appears.
 *
 * The icon URL logic is mirrored in scripts/lib/branding-manifest.js, which
 * builds the installed app's manifest. The two must agree, or the browser tab
 * and the home-screen icon would show the logo in different shapes.
 */

export const LOGO_SHAPES: LogoShape[] = ['round', 'square', 'original'];

/**
 * The corner treatment for a logo image of a given size.
 *
 * Shape only — never colour. An admin who picks "round" gets a round logo in
 * the same colours it had before.
 *
 * No shape chosen returns nothing at all, so every logo keeps exactly the look
 * it had before this setting existed until an admin decides otherwise.
 */
export function logoImageStyle(shape: LogoShape | null | undefined, size: number): ImageStyle {
  if (shape === 'round') return { borderRadius: size / 2, overflow: 'hidden' };
  if (shape === 'square') return { borderRadius: 0, overflow: 'hidden' };
  if (shape === 'original') return { borderRadius: 0, backgroundColor: 'transparent' };
  return {};
}

const CLOUDINARY_IMAGE = /res\.cloudinary\.com\/.+\/image\/upload\//;

/**
 * The logo as an icon: square, a fixed size, in the chosen shape.
 *
 * Asked of Cloudinary rather than drawn here — its delivery URLs carry the
 * transformation in the path, so a shaped, sized PNG is a different address
 * for the same upload, with nothing re-uploaded.
 *
 * `tab`      the browser tab. "Original" keeps the artwork's own outline.
 * `install`  a home-screen or desktop icon. Always square, because operating
 *            systems require it; "round" cuts it to a circle inside that square.
 * `maskable` Android's adaptive icon. Left square with a safe margin, because
 *            the launcher applies its own mask and a pre-cut circle would be
 *            cut again.
 *
 * Anything that is not a Cloudinary image is returned untouched.
 */
export function brandIconUrl(
  url: string,
  options: { size: number; shape?: LogoShape | null; purpose: 'tab' | 'install' | 'maskable' }
): string {
  if (!CLOUDINARY_IMAGE.test(url)) return url;
  const { size, shape, purpose } = options;
  const steps: string[] = [];

  if (purpose === 'maskable') {
    const inner = Math.round(size * 0.8);
    steps.push(`c_fit,w_${inner},h_${inner}`, `c_pad,w_${size},h_${size},b_white`);
  } else if (purpose === 'tab' && shape !== 'round' && shape !== 'square') {
    steps.push(`c_fit,w_${size},h_${size}`);
  } else {
    steps.push(`c_fit,w_${size},h_${size}`, `c_pad,w_${size},h_${size},b_white`);
    if (shape === 'round') steps.push('r_max');
  }
  steps.push('f_png,q_auto');

  // Existing transformation segments are replaced; the version and the file
  // name after them are kept, so the address still names the same upload.
  return url.replace(
    /\/image\/upload\/(?:[a-z]{1,3}_[^/]*\/)*/,
    `/image/upload/${steps.join('/')}/`
  );
}

/**
 * The Mowlavis a question can be addressed to.
 *
 * The list when there is one. Failing that, the single name from the older
 * "scholar name" setting, so a centre that set one before the list existed
 * still sees it rather than an empty choice.
 */
export function scholarsFrom(
  settings: Pick<AppSettings, 'qaScholars' | 'qaScholarName'> | null | undefined
): QaScholar[] {
  const list = (settings?.qaScholars ?? []).filter((s) => s && s.name && s.name.trim());
  if (list.length) {
    return list.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      userId: s.userId ?? null,
      userRole: s.userRole ?? null,
    }));
  }
  const legacy = settings?.qaScholarName?.trim();
  return legacy ? [{ id: 'default', name: legacy }] : [];
}

/** Banner items that can actually be shown. A malformed one is dropped, not thrown. */
export function usableBannerItems(items: BannerItem[] | null | undefined): BannerItem[] {
  return (items ?? []).filter(
    (item) => item && item.url && (item.type === 'image' || item.type === 'video')
  );
}

/** A short id for a list entry. Unique enough for a list an admin edits by hand. */
export function newListId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Whether a URL is an image, a video, or neither.
 *
 * Cloudinary keeps PDFs under its image path and audio under its video path,
 * so both are checked for and excluded: a banner cannot show a document or a
 * voice note.
 */
export function mediaKindOf(url: string | null | undefined): 'image' | 'video' | null {
  if (!url) return null;
  if (/\.(mp3|m4a|aac|wav|oga|opus)(\?|#|$)/i.test(url)) return null;
  if (/\.pdf(\?|#|$)/i.test(url)) return null;
  if (/res\.cloudinary\.com\/.+\/video\/upload\//.test(url)) return 'video';
  if (/(youtube\.com|youtu\.be|vimeo\.com)\//i.test(url)) return 'video';
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return 'video';
  if (CLOUDINARY_IMAGE.test(url)) return 'image';
  if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url)) return 'image';
  return null;
}
