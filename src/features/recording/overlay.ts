/**
 * The branding that ends up inside the video file.
 *
 * Every frame the camera produces is drawn onto a canvas, this paints over it,
 * and the canvas — not the camera — is what gets recorded. So the logo, the
 * name and the date are part of the picture: they survive being downloaded,
 * re-uploaded, forwarded on WhatsApp and played in anything. Branding stored
 * beside a video as a field is a caption, and a caption is not a watermark.
 *
 * Kept quiet on purpose. This is a teaching recording for a dawah centre, not a
 * broadcast: a small mark in the corner and a thin strip along the bottom, both
 * translucent, both out of the way of a speaker's face. Anything louder would
 * compete with the lesson.
 */

export interface OverlayBranding {
  /** Already-loaded images. Null when there is none, or when one failed. */
  logo: CanvasImageSource | null;
  banner: CanvasImageSource | null;
  /** The organisation's name — the one part of the mark that is always there. */
  name: string;
  /** Where it was recorded, shown small under the name. Optional. */
  venue?: string;
}

/** Navy, matching the app chrome, at the weight of a watermark rather than a bar. */
const STRIP_FILL = 'rgba(4, 30, 74, 0.55)';

/**
 * Paints the mark over a frame that has already been drawn.
 *
 * Sizes are all proportional to the frame, because the same code runs at 360p
 * on an old phone and 720p on a laptop, and a mark measured in pixels would be
 * a stamp on one and a billboard on the other.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: { width: number; height: number },
  branding: OverlayBranding,
  at: Date
): void {
  const { width, height } = frame;
  const pad = Math.round(height * 0.035);
  const stripHeight = Math.round(height * 0.13);

  ctx.save();

  // The strip along the bottom. Drawn first so everything else sits on top.
  ctx.fillStyle = STRIP_FILL;
  ctx.fillRect(0, height - stripHeight, width, stripHeight);

  const textLeft = pad;
  const nameSize = Math.round(stripHeight * 0.36);
  const metaSize = Math.round(stripHeight * 0.26);

  // A banner image, where one is configured, replaces the name text at the left
  // of the strip — it is the same thing said better, and showing both would be
  // saying it twice.
  let cursor = textLeft;
  if (branding.banner) {
    const bannerHeight = Math.round(stripHeight * 0.62);
    const bannerWidth = scaledWidth(branding.banner, bannerHeight);
    if (bannerWidth > 0 && bannerWidth < width * 0.55) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(
        branding.banner,
        cursor,
        height - stripHeight + (stripHeight - bannerHeight) / 2,
        bannerWidth,
        bannerHeight
      );
      ctx.globalAlpha = 1;
      cursor += bannerWidth + pad;
    }
  }

  if (!branding.banner || cursor === textLeft) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.font = `600 ${nameSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      branding.name,
      textLeft,
      height - stripHeight + nameSize + Math.round(stripHeight * 0.16)
    );

    if (branding.venue) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.font = `400 ${metaSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(
        branding.venue,
        textLeft,
        height - stripHeight + nameSize + metaSize + Math.round(stripHeight * 0.3)
      );
    }
  }

  // When this was recorded, at the right of the strip. Burned in rather than
  // stored as a field because the question it answers — "is this this week's
  // lesson or last year's?" — gets asked about a file long after it has left
  // the app that knows its metadata.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = `500 ${metaSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(stamp(at), width - pad, height - Math.round(stripHeight * 0.38));
  ctx.textAlign = 'left';

  // The logo, top corner, clear of both the strip and where a face sits.
  if (branding.logo) {
    const logoHeight = Math.round(height * 0.11);
    const logoWidth = scaledWidth(branding.logo, logoHeight);
    if (logoWidth > 0) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(branding.logo, width - pad - logoWidth, pad, logoWidth, logoHeight);
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

/** Width that keeps an image's aspect ratio at a given height. 0 if unmeasurable. */
function scaledWidth(image: CanvasImageSource, height: number): number {
  const natural = image as { naturalWidth?: number; naturalHeight?: number };
  if (!natural.naturalWidth || !natural.naturalHeight) return 0;
  return Math.round((natural.naturalWidth / natural.naturalHeight) * height);
}

/** `12 Mar 2026 · 19:30`, in a form that reads the same in every locale. */
function stamp(at: Date): string {
  const date = at.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}  ·  ${time}`;
}

/**
 * Loads a branding image so the canvas can be recorded afterwards.
 *
 * `crossOrigin` is the whole point of this function. A canvas that has had an
 * image drawn onto it from another origin without CORS permission becomes
 * "tainted", and a tainted canvas cannot be captured — which would mean the
 * logo silently killed the recording. Cloudinary sends the header this needs;
 * anything that does not is treated as having no logo at all.
 *
 * So a failure here costs a picture, never a lesson.
 */
export function loadBrandingImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url || typeof window === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn('[WeeklyClass] branding image could not be used in the recording:', url);
      resolve(null);
    };
    image.src = url;
  });
}
