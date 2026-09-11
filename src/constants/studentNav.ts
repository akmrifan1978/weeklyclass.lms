import type { NavSection } from '@/components/shared/NavDrawer';
import type { IslamicTile } from '@/components/shared/IslamicTiles';

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
export function studentNavSections(islamicVisible: IslamicTile[]): NavSection[] {
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
