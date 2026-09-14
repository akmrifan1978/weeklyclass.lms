import type { NavSection } from '@/components/shared/NavDrawer';
import type { IslamicTile } from '@/components/shared/IslamicTiles';
import type { Permission } from '@/types';

/**
 * The management screens a student can be given.
 *
 * Granting a student a permission used to change what the DATABASE allowed and
 * nothing else: the screens that use those permissions live in the teacher and
 * admin areas, which a student is redirected out of. So a grant took effect and
 * could not be reached. Each tool here is the same screen, served inside the
 * student area, and shown only to a student holding the permission for it.
 *
 * Only tools whose rules genuinely work for a student are listed. Lessons and
 * quizzes also need a teacher account under the rules, so offering them here
 * would be a button that fails.
 */
const STUDENT_TOOLS: {
  permissions: Permission[];
  icon: NavSection['entries'][number]['icon'];
  labelKey: string;
  route: string;
}[] = [
  { permissions: ['VIEW_ATTENDANCE', 'EDIT_ATTENDANCE'], icon: 'checkbox', labelKey: 'nav.attendance', route: '/(student)/manage/attendance' },
  { permissions: ['MANAGE_ANNOUNCEMENTS'], icon: 'megaphone-outline', labelKey: 'nav.announcements', route: '/(student)/manage/announcements' },
  { permissions: ['MANAGE_CALENDAR'], icon: 'calendar-outline', labelKey: 'nav.calendar', route: '/(student)/manage/calendar' },
  { permissions: ['UPLOAD_VIDEO'], icon: 'film-outline', labelKey: 'nav.videos', route: '/(student)/manage/videos' },
  { permissions: ['UPLOAD_VIDEO'], icon: 'mic-outline', labelKey: 'nav.recordings', route: '/(student)/manage/recordings' },
  { permissions: ['UPLOAD_MATERIAL'], icon: 'cloud-upload-outline', labelKey: 'nav.materials', route: '/(student)/manage/materials' },
  { permissions: ['MANAGE_ARTICLES'], icon: 'newspaper-outline', labelKey: 'nav.articles', route: '/(student)/manage/articles' },
  { permissions: ['CREATE_WORKBOOK'], icon: 'book', labelKey: 'nav.workbooks', route: '/(student)/manage/workbooks' },
];

/**
 * Everywhere a student can go, in the order the drawer lists it.
 *
 * Lifted out of the dashboard, where the same thirteen destinations existed as
 * hand-written tiles. Keeping them as data means the drawer and anything else
 * that needs the list read from one place, rather than the list living in JSX
 * on the one screen that was already too long because of it.
 *
 * The four in the tab bar — home, lessons, calendar, notifications, profile —
 * are deliberately NOT repeated here. A drawer that lists what is already a
 * thumb's reach away is a drawer people learn to distrust.
 */
export function studentNavSections(
  islamicVisible: IslamicTile[],
  /** Whether this person holds a permission. A guest holds none. */
  can: (permission: Permission) => boolean = () => false
): NavSection[] {
  const tools = STUDENT_TOOLS.filter((tool) => tool.permissions.some((p) => can(p))).map(
    ({ icon, labelKey, route }) => ({ icon, labelKey, route })
  );

  return [
    {
      titleKey: 'nav.myClass',
      entries: [
        { icon: 'videocam-outline', labelKey: 'nav.recordings', route: '/(student)/recordings' },
        { icon: 'folder-open-outline', labelKey: 'nav.materials', route: '/(student)/materials' },
        { icon: 'checkbox-outline', labelKey: 'nav.attendance', route: '/(student)/attendance' },
        { icon: 'videocam', labelKey: 'nav.onlineClasses', route: '/(student)/online-classes' },
      ],
    },
    {
      titleKey: 'nav.myWork',
      entries: [
        { icon: 'help-circle-outline', labelKey: 'nav.quizzes', route: '/(student)/quizzes' },
        { icon: 'trophy-outline', labelKey: 'nav.results', route: '/(student)/results' },
        { icon: 'stats-chart', labelKey: 'nav.myProgress', route: '/(student)/progress' },
        { icon: 'create-outline', labelKey: 'nav.notes', route: '/(student)/notes' },
        { icon: 'book-outline', labelKey: 'nav.workbooks', route: '/(student)/workbooks' },
      ],
    },
    // Only when something has been granted. A section with nothing in it
    // would be a heading promising tools that are not there.
    ...(tools.length ? [{ titleKey: 'nav.staffTools', entries: tools }] : []),
    {
      titleKey: 'nav.islamic',
      entries: islamicVisible.map((tile) => ({
        icon: tile.icon,
        labelKey: tile.labelKey,
        route: `/(student)${tile.path}`,
      })),
    },
    {
      titleKey: 'nav.more',
      entries: [
        { icon: 'ticket', labelKey: 'nav.events', route: '/(student)/events' },
        { icon: 'sparkles', labelKey: 'video.newReleases', route: '/(student)/new-releases' },
        { icon: 'chatbubbles', labelKey: 'nav.qa', route: '/(student)/qa' },
        { icon: 'help-buoy', labelKey: 'nav.support', route: '/(student)/support' },
      ],
    },
  ];
}
