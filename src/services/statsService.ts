import { COLLECTIONS } from '@/constants/app';
import type { DashboardStats } from '@/types';
import { countWhere } from './firestore';

/**
 * Dashboard counters.
 *
 * Uses Firestore aggregation queries (`getCountFromServer`), which bill one
 * read per 1,000 matched documents instead of one per document. The whole
 * dashboard is ~11 reads regardless of how large the platform grows.
 */
/**
 * The last set of counters, and when they were taken.
 *
 * `useAsync` refetches whenever the screen mounts, so walking Home -> Messages
 * -> Home re-ran all eleven aggregations for numbers that had not moved. In
 * memory rather than on disk on purpose: these are counts of other people's
 * records, they go stale by the minute, and a figure surviving a reload would
 * be worse than one that simply gets fetched again.
 */
let cache: { at: number; value: DashboardStats } | null = null;

/** Long enough to cover moving around the app, short enough to stay true. */
const CACHE_MS = 60_000;

/** Drops the counters. Called when the session ends, so the next person in
 *  never sees the last one's dashboard. */
export function resetDashboardStats(): void {
  cache = null;
}

export async function loadDashboardStats(
  options: { force?: boolean } = {}
): Promise<DashboardStats> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const [
    totalStudents,
    activeStudents,
    totalTeachers,
    activeTeachers,
    totalClasses,
    totalLessons,
    totalVideos,
    totalArticles,
    upcomingEvents,
    pendingRegistrations,
    notificationsSent,
  ] = await Promise.all([
    countWhere(COLLECTIONS.users, [['role', '==', 'student']]),
    countWhere(COLLECTIONS.users, [
      ['role', '==', 'student'],
      ['status', '==', 'active'],
    ]),
    countWhere(COLLECTIONS.users, [['role', '==', 'teacher']]),
    countWhere(COLLECTIONS.users, [
      ['role', '==', 'teacher'],
      ['status', '==', 'active'],
    ]),
    countWhere(COLLECTIONS.classes),
    countWhere(COLLECTIONS.lessons),
    countWhere(COLLECTIONS.videos),
    countWhere(COLLECTIONS.articles),
    countWhere(COLLECTIONS.calendarEvents, [['startsAt', '>=', new Date()]]),
    countWhere(COLLECTIONS.users, [['status', '==', 'pending']]),
    countWhere(COLLECTIONS.notifications, [['status', '==', 'sent']]),
  ]);

  const value: DashboardStats = {
    totalStudents,
    activeStudents,
    totalTeachers,
    activeTeachers,
    totalClasses,
    totalLessons,
    totalVideos,
    totalArticles,
    upcomingEvents,
    pendingRegistrations,
    notificationsSent,
  };

  cache = { at: Date.now(), value };
  return value;
}

/** Counters for a teacher, scoped to the classes they are assigned to. */
export async function loadTeacherStats(classIds: string[]): Promise<{
  classes: number;
  students: number;
  lessons: number;
  quizzes: number;
}> {
  if (classIds.length === 0) {
    return { classes: 0, students: 0, lessons: 0, quizzes: 0 };
  }

  // Firestore `in` filters accept at most 30 values; teachers realistically
  // hold far fewer, and the slice keeps the query legal either way.
  const scope = classIds.slice(0, 30);

  const [students, lessons, quizzes] = await Promise.all([
    countWhere(COLLECTIONS.users, [
      ['role', '==', 'student'],
      ['classId', 'in', scope],
    ]),
    countWhere(COLLECTIONS.lessons, [['classId', 'in', scope]]),
    countWhere(COLLECTIONS.quizzes, [['classId', 'in', scope]]),
  ]);

  return { classes: classIds.length, students, lessons, quizzes };
}
