/**
 * Where a notification opens, for the person opening it.
 *
 * A notification records one route, written by whoever sent it — and almost
 * always into the student section, "/(student)/qa", because students are who
 * most of them are for. A teacher or an admin tapping that was taken into a
 * section that is not theirs, and the app's role gate sent them straight back
 * to their own home page. From where they stood, the notification simply would
 * not open.
 *
 * So the route is translated into the reader's own section: the same page when
 * they have one, the list it belongs to when the original was one item in a
 * student's view, and nothing at all when they have no such page — in which
 * case the notification still opens, in full, just with no button to go on.
 *
 * No imports, so the checks can run this file directly under Node.
 */

type Role = 'student' | 'teacher' | 'admin';

/** Screens inside each role's tab bar. */
const TABS: Record<Role, string[]> = {
  student: ['calendar', 'lessons', 'notifications', 'profile'],
  teacher: ['attendance', 'classes', 'notifications', 'profile'],
  admin: [],
};

/** Every other screen each role has, by the first part of its path. */
const SCREENS: Record<Role, string[]> = {
  student: [
    'article', 'attendance', 'chat', 'duas', 'events', 'hadith', 'khutbah', 'lesson', 'manage',
    'materials', 'names', 'new-releases', 'notes', 'online-classes', 'prayer', 'progress', 'qa',
    'quiz', 'quizzes', 'quran', 'recordings', 'result', 'results', 'support', 'tajweed', 'video',
    'workbooks', 'zakat',
  ],
  teacher: [
    'calendar', 'chat', 'duas', 'events', 'hadith', 'khutbah', 'lessons', 'materials', 'names',
    'new-releases', 'notes', 'online-classes', 'prayer', 'qa', 'quizzes', 'quran', 'record',
    'recordings', 'results', 'students', 'support', 'tajweed', 'videos', 'workbooks', 'zakat',
  ],
  admin: [
    'announcements', 'articles', 'attendance', 'audit', 'branches', 'calendar', 'chat', 'classes',
    'duas', 'events', 'flyers', 'hadith', 'khutbah', 'languages', 'lessons', 'materials', 'names',
    'new-releases', 'notes', 'notifications', 'online-classes', 'permissions', 'prayer', 'profile',
    'qa', 'quizzes', 'quran', 'ratings', 'record', 'recordings', 'reports', 'results', 'settings',
    'students', 'support', 'tajweed', 'teachers', 'users', 'videos', 'workbooks', 'zakat',
  ],
};

/** A student's page about one item, and the list where staff find the same thing. */
const LIST_FOR: Record<string, string> = {
  lesson: 'lessons',
  quiz: 'quizzes',
  result: 'results',
  video: 'videos',
  article: 'articles',
};

function roleOf(role?: string | null): Role {
  return role === 'admin' || role === 'teacher' ? role : 'student';
}

function place(role: Role, segment: string, rest: string[], query: string): string | null {
  const path = [segment, ...rest].join('/');
  if (TABS[role].includes(segment)) return `/(${role})/(tabs)/${path}${query}`;
  if (SCREENS[role].includes(segment)) return `/(${role})/${path}${query}`;
  return null;
}

/** The reader's own inbox. */
export function notificationsRoute(role?: string | null): string {
  return roleOf(role) === 'admin' ? '/(admin)/notifications?tab=inbox' : '/notifications';
}

/**
 * The route to open for this reader, or null when there is nowhere to go.
 * "/" is treated as nowhere: it is what a notification with no page was given.
 */
export function routeForRole(route?: string | null, role?: string | null): string | null {
  if (!route || route === '/') return null;
  const reader = roleOf(role);

  // The inbox itself, from a tapped phone notification. An admin's inbox is
  // one tab of the notifications page rather than a page of its own.
  if (route.startsWith('/notifications')) {
    if (reader !== 'admin') return route;
    const query = route.includes('?') ? `&${route.split('?')[1]}` : '';
    return `/(admin)/notifications?tab=inbox${query}`;
  }

  const match = /^\/\((student|teacher|admin)\)\/(?:\(tabs\)\/)?([^?]*)(\?.*)?$/.exec(route);
  if (!match) return route; // Not in any one section, so fine for everybody.
  const [, group, path, query = ''] = match;
  if (group === reader) return route;

  const [segment = '', ...rest] = path.split('/').filter(Boolean);
  if (!segment) return `/(${reader})`;

  const same = place(reader, segment, rest, query);
  if (same) return same;
  // One item in somebody else's section: the list it belongs to in this one.
  return LIST_FOR[segment] ? place(reader, LIST_FOR[segment], [], '') : null;
}
