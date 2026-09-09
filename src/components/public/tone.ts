import { brand, colors } from '@/constants/theme';

/**
 * The public website's surfaces, in one place.
 *
 * The site is navy end to end, which is the palette the app has always used and
 * is not something a page gets to decide for itself. On navy every panel has to
 * be a translucent white rather than a solid one, and those values were
 * previously written out by hand in a dozen stylesheets — which is how a page
 * quietly ends up a different shade from the one beside it.
 *
 * Every value here is one the app already used before this website existed.
 * Nothing was picked by eye: `panel` is the translucency the event cards on the
 * front page have always had, `body` is the sand the links have always been,
 * and `title` is plain white. Naming them changes nothing on screen; it means
 * the next change to any of them is one edit rather than sixty.
 */
export const tone = {
  /** The page itself. */
  ground: brand.navyDeep,
  /** A band lifted off the ground — the hero at the top of every page. */
  band: brand.navy,

  /** The bar across the top, and the hairline under it. */
  bar: 'rgba(255,255,255,0.05)',
  barLine: 'rgba(255,255,255,0.10)',

  /** Cards, and the line between two rows inside one. */
  panel: 'rgba(255,255,255,0.07)',
  panelLine: 'rgba(255,255,255,0.12)',

  /** Things you press or type into: search fields, chips, outlined buttons. */
  control: 'rgba(255,255,255,0.06)',
  controlLine: 'rgba(255,255,255,0.22)',
  /** For a control that has to hold its own against a card behind it. */
  controlLineStrong: 'rgba(255,255,255,0.30)',
  pressed: 'rgba(255,255,255,0.10)',

  /** Orange, softened enough to sit behind text without shouting. */
  accentPanel: 'rgba(237,91,3,0.16)',
  accentLine: 'rgba(237,91,3,0.34)',

  /** Headings and anything that has to be read first. */
  title: colors.textInverse,
  /** Body text and labels. */
  body: brand.sandLight,
  /** A step back from body: captions, second lines, dates. */
  muted: 'rgba(255,255,255,0.62)',
  /** A step back again: the line under a hero, a tagline. */
  faint: 'rgba(229,197,160,0.78)',
} as const;
