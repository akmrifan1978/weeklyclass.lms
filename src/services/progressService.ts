import { COLLECTIONS } from '@/constants/app';
import type { AppUser, AttendanceRecord, Result } from '@/types';

import { listPage } from './firestore';
import { listQuizzes } from './quizService';
import { lessonsForStudent } from './contentService';
import * as plans from './quranPlanService';

/**
 * One student's own progress.
 *
 * Assembled on the client from records they can already read, rather than
 * maintained as a running counter somewhere. A counter would be faster and would
 * drift: every place that marks attendance or submits an assignment would have
 * to remember to increment it, and the first one that forgot would leave a
 * number nobody could explain. Recomputing is slower and always right.
 *
 * Everything is best-effort. A student with no class yet, or a collection they
 * cannot read, gets a zero rather than an error screen — this is an encouragement
 * screen, and failing it entirely because attendance was unreadable would be a
 * poor trade.
 */

export interface UserProgress {
  attendance: { present: number; total: number; percent: number };
  assignments: { submitted: number; available: number; averageScore: number | null };
  lessons: { available: number };
  quran: {
    active: boolean;
    pagesRead: number;
    pagesTotal: number;
    percent: number;
    streak: number;
  } | null;
}

const safe = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await run();
  } catch {
    return fallback;
  }
};

export async function loadUserProgress(user: AppUser): Promise<UserProgress> {
  const [attendance, results, quizzes, lessons, plan] = await Promise.all([
    safe(
      () =>
        listPage<AttendanceRecord>(COLLECTIONS.attendance, {
          filters: [['studentId', '==', user.uid]],
          orderByField: 'date',
          direction: 'desc',
          pageSize: 200,
        }).then((page) => page.items),
      [] as AttendanceRecord[]
    ),
    safe(
      () =>
        listPage<Result>(COLLECTIONS.results, {
          filters: [['studentId', '==', user.uid]],
          orderByField: 'createdAt',
          direction: 'desc',
          pageSize: 100,
        }).then((page) => page.items),
      [] as Result[]
    ),
    safe(
      () =>
        user.classId
          ? listQuizzes({ classId: user.classId, status: 'published', pageSize: 100 }).then(
              (page) => page.items.length
            )
          : Promise.resolve(0),
      0
    ),
    safe(
      () =>
        user.classId
          ? lessonsForStudent(user.classId, 100).then((page) => page.items.length)
          : Promise.resolve(0),
      0
    ),
    safe(() => plans.loadPlan(), null),
  ]);

  const present = attendance.filter(
    (a: AttendanceRecord) => a.status === 'present' || a.status === 'late'
  ).length;

  const scored = results.filter((r: Result) => typeof r.percentage === 'number');
  const averageScore = scored.length
    ? Math.round(
        scored.reduce((sum: number, r: Result) => sum + (r.percentage ?? 0), 0) /
          scored.length
      )
    : null;

  return {
    attendance: {
      present,
      total: attendance.length,
      percent: attendance.length ? Math.round((present / attendance.length) * 100) : 0,
    },
    assignments: {
      submitted: results.length,
      available: quizzes,
      averageScore,
    },
    lessons: { available: lessons },
    quran: plan
      ? {
          active: !plans.isFinished(plan),
          ...(() => {
            const progress = plans.progressFor(plan, 0);
            return {
              pagesRead: progress.pagesRead,
              pagesTotal: progress.pagesTotal,
              percent: progress.percent,
              streak: progress.streak,
            };
          })(),
        }
      : null,
  };
}
