/**
 * Granular permission system.
 *
 * Permissions are stored per-user on `users/{uid}.permissions` as a map of
 * `Permission -> boolean`. Admins implicitly hold every permission; teachers
 * hold only what an admin has explicitly granted; students hold none of these
 * (their access is governed by ownership + class membership rules instead).
 *
 * IMPORTANT: this list is mirrored in `firebase/firestore.rules`. Anything
 * added here must also be enforced there — hiding a button is not security.
 */

export const PERMISSIONS = [
  // Students
  'VIEW_STUDENTS',
  'CREATE_STUDENTS',
  'EDIT_STUDENTS',
  'DELETE_STUDENTS',
  // Teachers
  'VIEW_TEACHERS',
  'CREATE_TEACHERS',
  'EDIT_TEACHERS',
  'DELETE_TEACHERS',
  // Classes
  'VIEW_CLASSES',
  'CREATE_CLASSES',
  'EDIT_CLASSES',
  'DELETE_CLASSES',
  // Lessons
  'VIEW_LESSONS',
  'CREATE_LESSONS',
  'EDIT_LESSONS',
  'DELETE_LESSONS',
  // Videos & recordings
  'UPLOAD_VIDEO',
  'DELETE_VIDEO',
  // Study materials
  'UPLOAD_MATERIAL',
  'DELETE_MATERIAL',
  // Attendance
  'VIEW_ATTENDANCE',
  'EDIT_ATTENDANCE',
  // Workbooks — the teaching board, handed out to students
  'CREATE_WORKBOOK',
  'PUBLISH_WORKBOOK',
  // Questions asked and answered in the open
  'ANSWER_QUESTIONS',
  'PUBLISH_QUESTIONS',
  // Quizzes
  'CREATE_QUIZ',
  'EDIT_QUIZ',
  'DELETE_QUIZ',
  // Results
  'VIEW_RESULTS',
  'EDIT_RESULTS',
  // Content & comms
  'MANAGE_CALENDAR',
  'MANAGE_ARTICLES',
  'MANAGE_ANNOUNCEMENTS',
  'SEND_NOTIFICATIONS',
  // Administration
  'MANAGE_USERS',
  'MANAGE_SETTINGS',
  'MANAGE_BRANCHES',
  'MANAGE_LANGUAGES',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionMap = Partial<Record<Permission, boolean>>;

/** UI grouping for the admin permission editor. */
export const PERMISSION_GROUPS: { group: string; permissions: Permission[] }[] = [
  { group: 'Students', permissions: ['VIEW_STUDENTS', 'CREATE_STUDENTS', 'EDIT_STUDENTS', 'DELETE_STUDENTS'] },
  { group: 'Teachers', permissions: ['VIEW_TEACHERS', 'CREATE_TEACHERS', 'EDIT_TEACHERS', 'DELETE_TEACHERS'] },
  { group: 'Classes', permissions: ['VIEW_CLASSES', 'CREATE_CLASSES', 'EDIT_CLASSES', 'DELETE_CLASSES'] },
  { group: 'Lessons', permissions: ['VIEW_LESSONS', 'CREATE_LESSONS', 'EDIT_LESSONS', 'DELETE_LESSONS'] },
  { group: 'Videos', permissions: ['UPLOAD_VIDEO', 'DELETE_VIDEO'] },
  { group: 'Study Materials', permissions: ['UPLOAD_MATERIAL', 'DELETE_MATERIAL'] },
  { group: 'Attendance', permissions: ['VIEW_ATTENDANCE', 'EDIT_ATTENDANCE'] },
  { group: 'Workbooks', permissions: ['CREATE_WORKBOOK', 'PUBLISH_WORKBOOK'] },
  { group: 'Questions & Answers', permissions: ['ANSWER_QUESTIONS', 'PUBLISH_QUESTIONS'] },
  { group: 'Quizzes', permissions: ['CREATE_QUIZ', 'EDIT_QUIZ', 'DELETE_QUIZ'] },
  { group: 'Results', permissions: ['VIEW_RESULTS', 'EDIT_RESULTS'] },
  {
    group: 'Content & Communication',
    permissions: ['MANAGE_CALENDAR', 'MANAGE_ARTICLES', 'MANAGE_ANNOUNCEMENTS', 'SEND_NOTIFICATIONS'],
  },
  {
    group: 'Administration',
    permissions: ['MANAGE_USERS', 'MANAGE_SETTINGS', 'MANAGE_BRANCHES', 'MANAGE_LANGUAGES'],
  },
];

/** Sensible starting point when an admin creates a new teacher. */
export const DEFAULT_TEACHER_PERMISSIONS: PermissionMap = {
  VIEW_STUDENTS: true,
  VIEW_CLASSES: true,
  VIEW_LESSONS: true,
  CREATE_LESSONS: true,
  EDIT_LESSONS: true,
  VIEW_ATTENDANCE: true,
  EDIT_ATTENDANCE: true,
  // A teacher can write on the board and answer what is asked of them from
  // the day they are added. Both are the ordinary work of teaching, and
  // withholding them by default means every new teacher starts by asking.
  CREATE_WORKBOOK: true,
  PUBLISH_WORKBOOK: true,
  ANSWER_QUESTIONS: true,
  VIEW_RESULTS: true,
  UPLOAD_MATERIAL: true,
};

/** Every permission set to true — the effective set for an ADMIN. */
export function allPermissions(): Record<Permission, boolean> {
  return PERMISSIONS.reduce(
    (acc, p) => {
      acc[p] = true;
      return acc;
    },
    {} as Record<Permission, boolean>
  );
}

export function emptyPermissions(): Record<Permission, boolean> {
  return PERMISSIONS.reduce(
    (acc, p) => {
      acc[p] = false;
      return acc;
    },
    {} as Record<Permission, boolean>
  );
}
