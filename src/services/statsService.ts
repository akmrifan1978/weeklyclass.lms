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
export async function loadDashboardStats(): Promise<DashboardStats> {
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

  return {
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
