import type { Ionicons } from '@expo/vector-icons';

/**
 * The public website's menu.
 *
 * Ordered to be READ DOWN TWO COLUMNS, not across: the first five entries fill
 * the left column and the rest fill the right. Laying nine items out with a
 * wrapping row would pair them across instead, which puts Home next to
 * Teachers and breaks the grouping the design depends on.
 *
 * Materials is deliberately absent. It is a signed-in destination — the files
 * belong to a class and are read by the students in it — and it has no public
 * page to point at.
 */
export interface PublicNavItem {
  /** Translation key for the label. */
  key: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
}

export const PUBLIC_NAV: readonly PublicNavItem[] = [
  { key: 'nav.home', route: '/', icon: 'home-outline' },
  { key: 'nav.teachers', route: '/(public)/teachers', icon: 'people-outline' },
  { key: 'nav.videos', route: '/(public)/videos', icon: 'videocam-outline' },
  { key: 'nav.events', route: '/(public)/events', icon: 'calendar-outline' },
  { key: 'about.title', route: '/(auth)/about', icon: 'information-circle-outline' },

  { key: 'nav.classes', route: '/(public)/classes', icon: 'school-outline' },
  { key: 'nav.lessons', route: '/(public)/lessons', icon: 'book-outline' },
  { key: 'nav.quran', route: '/(public)/quran', icon: 'bookmarks-outline' },
  { key: 'nav.contact', route: '/(public)/contact', icon: 'mail-outline' },
] as const;

/** Where the left column ends and the right one begins. */
export const PUBLIC_NAV_SPLIT = 5;

/**
 * Whether a menu entry is the page being looked at.
 *
 * Compared on the tail of the path rather than the whole of it, because the
 * router reports a public route as `/teachers` while the entry above carries
 * the group in its route — `(public)` is a grouping, not a path segment.
 */
export function isCurrentRoute(route: string, pathname: string): boolean {
  const leaf = route.replace(/^.*\)/, '') || '/';
  if (leaf === '/') return pathname === '/' || pathname === '';
  return pathname === leaf;
}
