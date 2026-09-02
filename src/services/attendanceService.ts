import { COLLECTIONS } from '@/constants/app';
import { toISOMonth } from '@/utils/date';
import type {
  AppUser,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummary,
} from '@/types';
import { batchWrite, listAll, listPage, type Cursor, type Page } from './firestore';
import * as audit from './auditService';

/**
 * Attendance.
 *
 * One document per student per class per day, with a deterministic id
 * (`{classId}_{date}_{studentId}`). Re-saving a register overwrites rather than
 * duplicating, which makes the whole operation idempotent and lets the whole
 * class be written in a single batch.
 */

export function attendanceId(classId: string, date: string, studentId: string): string {
  return `${classId}_${date}_${studentId}`;
}

export interface MarkEntry {
  studentId: string;
  studentName?: string;
  status: AttendanceStatus;
  note?: string;
}

export async function markAttendance(
  params: {
    classId: string;
    branchId?: string | null;
    date: string;
    lessonId?: string | null;
    entries: MarkEntry[];
  },
  actor: AppUser
): Promise<void> {
  const month = toISOMonth(new Date(params.date));

  await batchWrite(
    params.entries.map((entry) => ({
      type: 'set' as const,
      path: COLLECTIONS.attendance,
      id: attendanceId(params.classId, params.date, entry.studentId),
      data: {
        studentId: entry.studentId,
        studentName: entry.studentName ?? null,
        classId: params.classId,
        branchId: params.branchId ?? null,
        date: params.date,
        month,
        status: entry.status,
        note: entry.note ?? null,
        lessonId: params.lessonId ?? null,
        markedBy: actor.uid,
      },
    }))
  );

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.attendance,
    documentId: `${params.classId}_${params.date}`,
    summary: `Recorded attendance for ${params.entries.length} student(s) on ${params.date}`,
  });
}

/** The register for one class on one day, used to prefill the marking screen. */
export function registerFor(classId: string, date: string): Promise<AttendanceRecord[]> {
  return listAll<AttendanceRecord>(COLLECTIONS.attendance, {
    filters: [
      ['classId', '==', classId],
      ['date', '==', date],
    ],
    pageSize: 300,
  });
}

export function listForStudent(options: {
  studentId: string;
  month?: string;
  cursor?: Cursor;
  pageSize?: number;
}): Promise<Page<AttendanceRecord>> {
  return listPage<AttendanceRecord>(COLLECTIONS.attendance, {
    filters: [
      ['studentId', '==', options.studentId],
      options.month ? ['month', '==', options.month] : null,
    ],
    orderByField: 'date',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? 60,
  });
}

export function listForClass(options: {
  classId: string;
  month?: string;
  pageSize?: number;
}): Promise<AttendanceRecord[]> {
  return listAll<AttendanceRecord>(COLLECTIONS.attendance, {
    filters: [
      ['classId', '==', options.classId],
      options.month ? ['month', '==', options.month] : null,
    ],
    orderByField: 'date',
    direction: 'desc',
    pageSize: options.pageSize ?? 300,
  });
}

/**
 * Attendance percentage.
 *
 * `late` counts as attendance (the student was there); `excused` is removed
 * from the denominator rather than counted against the student.
 */
export function summarise(records: AttendanceRecord[]): AttendanceSummary {
  const summary: AttendanceSummary = {
    total: records.length,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    percentage: 0,
  };

  for (const record of records) {
    summary[record.status] += 1;
  }

  const counted = summary.total - summary.excused;
  summary.percentage =
    counted > 0 ? Math.round(((summary.present + summary.late) / counted) * 1000) / 10 : 0;

  return summary;
}

/** Month-by-month breakdown for the student attendance report. */
export function summariseByMonth(
  records: AttendanceRecord[]
): { month: string; summary: AttendanceSummary }[] {
  const buckets = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const key = record.month || record.date.slice(0, 7);
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, items]) => ({ month, summary: summarise(items) }));
}

/** Per-student totals for a class report. */
export function summariseByStudent(
  records: AttendanceRecord[]
): { studentId: string; studentName: string; summary: AttendanceSummary }[] {
  const buckets = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const bucket = buckets.get(record.studentId) ?? [];
    bucket.push(record);
    buckets.set(record.studentId, bucket);
  }
  return Array.from(buckets.entries())
    .map(([studentId, items]) => ({
      studentId,
      studentName: items[0]?.studentName ?? studentId,
      summary: summarise(items),
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}
