/**
 * What a handwritten page is made of.
 *
 * A page is a list of strokes, and a stroke is a tool, a colour, a width and
 * the path the hand took. Nothing is rasterised: the page stays a description
 * of movements, which is why it can be undone stroke by stroke, re-rendered
 * crisply at any size, and stored in a few kilobytes instead of a photograph.
 *
 * COORDINATES ARE LOGICAL, never pixels. Every point is expressed against a
 * fixed page of CANVAS_WIDTH x CANVAS_HEIGHT, so a note written on a teacher's
 * tablet arrives on a student's phone as the same page rather than the same
 * number of pixels. Only the drawing surface knows the scale factor.
 *
 * POINTS ARE FLAT — [x0, y0, x1, y1, ...] rather than [[x, y], ...]. Firestore
 * cannot store an array of arrays at all, so the nested form would have to be
 * flattened on the way out and rebuilt on the way in. Keeping it flat here
 * means one shape everywhere, and it halves the JSON.
 */

/** The page everything is drawn against. Roughly A4, portrait. */
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 1414;

export type PenTool = 'pen' | 'highlighter' | 'eraser';

export interface Stroke {
  tool: Exclude<PenTool, 'eraser'>;
  color: string;
  width: number;
  /** Flat [x, y, x, y, ...] in logical page coordinates. */
  points: number[];
}

/** The ink a teacher can pick up. Named so the toolbar can label them. */
export const PEN_COLORS = [
  { value: '#111A2E', key: 'workbook.inkBlack' },
  { value: '#0B3C7D', key: 'workbook.inkBlue' },
  { value: '#C0392B', key: 'workbook.inkRed' },
  { value: '#1B8A5A', key: 'workbook.inkGreen' },
] as const;

export const HIGHLIGHT_COLORS = [
  { value: '#FFE066', key: 'workbook.markYellow' },
  { value: '#9BE8A8', key: 'workbook.markGreen' },
  { value: '#9AD5FF', key: 'workbook.markBlue' },
  { value: '#FFB3C7', key: 'workbook.markPink' },
] as const;

/** Nib sizes, in logical units. */
export const PEN_WIDTHS = [3, 6, 12] as const;
export const HIGHLIGHT_WIDTH = 34;

/** A highlighter must not hide what it marks. */
export const HIGHLIGHT_OPACITY = 0.35;

/** How close the eraser must come to a stroke to take it. */
export const ERASER_RADIUS = 22;

/**
 * An SVG path for one stroke.
 *
 * Straight segments between points, not curves. A quadratic smoothing pass
 * looks marginally better on a slow, deliberate line and noticeably worse on a
 * fast one, where it rounds off the corners of letters — and handwriting is
 * mostly fast, deliberate corners.
 *
 * A stroke of a single point is drawn as a dot, because tapping the page to
 * make a full stop is a thing people do and an empty path would swallow it.
 */
export function strokePath(stroke: Stroke): string {
  const p = stroke.points;
  if (p.length < 2) return '';
  if (p.length === 2) {
    // A dot: a hairline segment, so the round cap draws it as a circle.
    return `M${p[0]} ${p[1]} L${p[0] + 0.01} ${p[1]}`;
  }
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length; i += 2) d += ` L${p[i]} ${p[i + 1]}`;
  return d;
}

/**
 * Whether the eraser at this point should take this stroke.
 *
 * Whole strokes are erased rather than pixels. Pixel erasing on vector ink
 * means either rasterising the page — losing everything the format is for — or
 * splitting strokes into fragments, which turns one undo into twenty. Taking
 * the whole stroke is what a teacher means nine times in ten anyway: they drew
 * the wrong letter and want it gone.
 */
export function strokeHitBy(stroke: Stroke, x: number, y: number): boolean {
  const p = stroke.points;
  // The nib has width, so a thick line is hit from further away than a thin one.
  const reach = ERASER_RADIUS + stroke.width / 2;
  const reachSquared = reach * reach;

  if (p.length === 2) {
    const dx = p[0] - x;
    const dy = p[1] - y;
    return dx * dx + dy * dy <= reachSquared;
  }

  /*
   * Measured against the SEGMENTS, not the recorded points.
   *
   * Testing only the points looks equivalent and is not. A line drawn quickly
   * is thinned down to very few of them — a fast straight stroke can be kept
   * as nothing but its two ends — and rubbing the middle of it would then find
   * no point nearby and do nothing at all. The ink is on the segment between
   * the points, so that is what the eraser has to reach for.
   */
  for (let i = 0; i < p.length - 2; i += 2) {
    if (distanceSquaredToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reachSquared) {
      return true;
    }
  }
  return false;
}

/** Squared distance from a point to a line segment. Squared, to avoid a root. */
function distanceSquaredToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;

  // A zero-length segment is a point, and dividing by its length would be a
  // NaN that compares false against everything — an eraser that silently fails.
  if (lengthSquared === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }

  // How far along the segment the nearest point lies, clamped to its ends so
  // the answer is a distance to the segment rather than to the infinite line.
  let along = ((px - ax) * abx + (py - ay) * aby) / lengthSquared;
  along = Math.max(0, Math.min(1, along));

  const dx = px - (ax + along * abx);
  const dy = py - (ay + along * aby);
  return dx * dx + dy * dy;
}

/**
 * Drops points too close together to see.
 *
 * A finger dragged slowly reports hundreds of points a second, nearly all of
 * them within a pixel of the last. Kept, they cost storage and rendering time
 * and change nothing on screen. Dropped, a page of handwriting stays small
 * enough to sit comfortably inside a Firestore document.
 *
 * The first and last points are always kept: the last is where the hand
 * stopped, and rounding it away shortens every stroke by a fraction.
 */
export function thin(points: number[], minGap = 2.5): number[] {
  if (points.length <= 4) return points;
  const out = [points[0], points[1]];
  const gapSquared = minGap * minGap;
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i] - out[out.length - 2];
    const dy = points[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= gapSquared) out.push(points[i], points[i + 1]);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

/**
 * Strokes as stored.
 *
 * A JSON string, not an array of objects, and not for tidiness: Firestore
 * rejects nested arrays outright, and `points` is an array inside an object
 * inside an array. Serialising the lot sidesteps that, and means a page is one
 * field to read, write and size-check rather than a structure to walk.
 */
export function encodeStrokes(strokes: Stroke[]): string {
  // Coordinates are rounded to whole logical units on the way out. A tenth of
  // a unit is a fifth of a phone pixel — invisible, and it doubles the size of
  // every number.
  return JSON.stringify(
    strokes.map((s) => ({ ...s, points: s.points.map((n) => Math.round(n)) }))
  );
}

export function decodeStrokes(raw: string | null | undefined): Stroke[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything malformed is dropped rather than thrown. A page that half
    // renders is better than a screen that refuses to open, and the teacher
    // can see at a glance what is missing.
    return parsed.filter(
      (s): s is Stroke =>
        s &&
        (s.tool === 'pen' || s.tool === 'highlighter') &&
        typeof s.color === 'string' &&
        typeof s.width === 'number' &&
        Array.isArray(s.points)
    );
  } catch {
    return [];
  }
}

/**
 * Roughly how much room a page takes, in bytes.
 *
 * Used to warn before a page grows past what one Firestore document can hold.
 * A limit discovered at the moment of saving is a lost lesson.
 */
export function sizeOf(strokes: Stroke[]): number {
  return encodeStrokes(strokes).length;
}

/** Firestore's hard limit is 1 MiB per document; this leaves room for the rest. */
export const PAGE_BYTE_BUDGET = 800_000;
