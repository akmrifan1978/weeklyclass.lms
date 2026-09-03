import type { Timestamp } from 'firebase/firestore';
import type { PermissionMap } from './permissions';

/** Firestore timestamps arrive as `Timestamp`; we write `Date`/serverTimestamp. */
export type FireDate = Timestamp | Date | null;

export type UserRole = 'admin' | 'teacher' | 'student';
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';
export type ContentStatus = 'draft' | 'published' | 'archived';
export type LanguageCode = 'en' | 'ta' | 'si' | 'ar';

export interface BaseDoc {
  id: string;
  createdAt?: FireDate;
  updatedAt?: FireDate;
  createdBy?: string;
  /** Soft delete — records are hidden, never destroyed, unless purged by admin. */
  deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AppUser extends BaseDoc {
  uid: string;
  fullName: string;
  /** Lowercased, unique. Mirrored into `usernames/{username}` for lookup. */
  username: string;
  /** Contact address. NOT unique — a household may share one inbox. */
  email: string;
  /**
   * The address the account signs in with. Equal to `email` unless that was
   * already held by another account, in which case it is derived from the
   * mobile number instead. Absent on accounts created before this existed.
   */
  authEmail?: string;
  /** The unique identity. One mobile number, one account. */
  mobile: string;
  role: UserRole;
  status: UserStatus;
  country: string;
  language: LanguageCode;
  /**
   * Per-dashboard language choices, so they follow someone to a new device.
   * The device's own stored choice wins where the two disagree.
   */
  dashboardLanguages?: Partial<Record<string, LanguageCode>>;
  /**
   * The daily Qur'an reading plan, mirrored from the device so it survives a
   * new phone. The device copy is the source of truth — see quranPlanService.
   */
  quranPlan?: unknown;
  profileImage?: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  classId?: string | null;
  /** Teachers may be assigned to several classes. */
  classIds?: string[];
  permissions?: PermissionMap;
  lastLoginAt?: FireDate;

  // Student-specific
  studentId?: string;
  dateOfBirth?: string | null;
  gender?: 'male' | 'female' | null;

  // Teacher-specific
  teacherId?: string;
  qualification?: string;

  /** Expo / FCM push tokens, keyed by device id. */
  pushTokens?: Record<string, string>;

  /** When the registration declaration was accepted. */
  declarationAcceptedAt?: FireDate;
}

/** `usernames/{usernameLower}` — enforces global username uniqueness. */
export interface UsernameIndex {
  uid: string;
  /** Contact address, kept for display. */
  email: string;
  /** What sign-in actually uses; falls back to `email` on older rows. */
  authEmail?: string;
  role: UserRole;
}

/** `mobiles/{mobileKey}` — the real uniqueness constraint on an account. */
export interface MobileIndex {
  uid: string;
  username: string;
  authEmail?: string;
}

// ---------------------------------------------------------------------------
// Organisation hierarchy: Organization > Branch > Class
// ---------------------------------------------------------------------------

export interface Organization extends BaseDoc {
  name: string;
  description?: string;
  status: 'active' | 'inactive';
}

export interface Country extends BaseDoc {
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "SA", "LK", "IN", "GB". */
  code: string;
  dialCode?: string;
  status: 'active' | 'inactive';
}

export interface Branch extends BaseDoc {
  name: string;
  organizationId: string;
  countryCode: string;
  city?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  timezone?: string;
  status: 'active' | 'inactive';
}

export interface ClassRoom extends BaseDoc {
  name: string;
  code?: string;
  description?: string;
  branchId: string;
  organizationId?: string;
  /** Primary teacher. */
  teacherId?: string | null;
  /** All teachers permitted to act on this class. */
  teacherIds: string[];
  subjectIds?: string[];
  language: LanguageCode;
  schedule?: string;
  studentCount?: number;
  status: 'active' | 'inactive';
}

export interface Subject extends BaseDoc {
  name: string;
  code?: string;
  description?: string;
  status: 'active' | 'inactive';
}

// ---------------------------------------------------------------------------
// Learning content
// ---------------------------------------------------------------------------

export interface Lesson extends BaseDoc {
  title: string;
  description: string;
  weekNumber: number;
  subject?: string;
  teacherId?: string | null;
  classId: string;
  branchId?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  pdfUrl?: string | null;
  imageUrl?: string | null;
  language: LanguageCode;
  /** Minutes. */
  duration?: number;
  publishDate?: FireDate;
  status: ContentStatus;
}

export type VideoKind = 'video' | 'recording';

export interface VideoItem extends BaseDoc {
  title: string;
  description?: string;
  speaker?: string;
  /** Where the programme was held, e.g. "Jeddah Dawah Center — Tamil Section". */
  venue?: string;
  /** Event/recording date, distinct from createdAt. */
  date?: FireDate;
  thumbnail?: string | null;

  // Branding is COPIED onto each recording rather than read from settings at
  // display time. Changing the organisation logo must not silently restyle
  // everything ever published — each recording keeps the identity it went out
  // with. New recordings pick up the current default when they are created.
  logoUrl?: string | null;
  bannerUrl?: string | null;
  videoUrl: string;
  /** Minutes. */
  duration?: number;
  language: LanguageCode;
  branchId?: string | null;
  classId?: string | null;
  teacherId?: string | null;
  /** Exactly one document should have this true; enforced by videoService. */
  isFeatured: boolean;
  /**
   * Broadcasting right now. A YouTube Live link embeds exactly like any other
   * video, so this changes nothing technical — it drives the LIVE badge and
   * pushes the item to the top of the student's home screen, which is the part
   * that actually matters when something is happening at this moment.
   */
  isLive?: boolean;
  kind: VideoKind;
  status: ContentStatus;
}

export interface Article extends BaseDoc {
  title: string;
  content: string;
  summary: string;
  author: string;
  image?: string | null;
  language: LanguageCode;
  publishedAt?: FireDate;
  isFeatured: boolean;
  status: ContentStatus;
}

export type MaterialType = 'pdf' | 'audio' | 'image' | 'document' | 'link';

export interface Material extends BaseDoc {
  title: string;
  description?: string;
  type: MaterialType;
  url: string;
  /** Storage path, kept so the file can be deleted alongside the record. */
  storagePath?: string | null;
  /** Bytes. */
  size?: number;
  classId?: string | null;
  branchId?: string | null;
  lessonId?: string | null;
  language: LanguageCode;
  status: ContentStatus;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type AudienceRole = 'all' | 'students' | 'teachers';

/**
 * Where an online class is hosted. Nothing is integrated with these services —
 * the app stores and opens a link, which is what keeps online classes free and
 * lets a branch use whichever platform it already has.
 */
export type MeetingProvider = 'zoom' | 'meet' | 'other';

export interface CalendarEvent extends BaseDoc {
  title: string;
  description?: string;
  /** ISO date `YYYY-MM-DD` — queryable and timezone-stable for day grouping. */
  date: string;
  /** `HH:mm` 24h. */
  startTime: string;
  endTime: string;
  venue?: string;
  speaker?: string;
  teacherId?: string | null;

  /**
   * Online meeting. `provider` only decides the label and icon on the join
   * button — the link is what actually matters, and any provider works.
   */
  meetingProvider?: MeetingProvider;
  meetingUrl?: string | null;
  /** Meeting ID / passcode, shown for people who join from the app manually. */
  meetingId?: string | null;
  meetingPasscode?: string | null;

  // Branding is copied onto the event, exactly as it is for recordings, so a
  // published session keeps the identity it was announced with.
  logoUrl?: string | null;
  bannerUrl?: string | null;
  branchId?: string | null;
  classId?: string | null;
  targetAudience: AudienceRole;
  /** Precomputed for ordering/queries: `date` + `startTime` as a real instant. */
  startsAt: FireDate;
  status: 'scheduled' | 'cancelled' | 'completed';
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord extends BaseDoc {
  studentId: string;
  studentName?: string;
  classId: string;
  branchId?: string | null;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** `YYYY-MM` — lets monthly reports be a single equality query. */
  month: string;
  status: AttendanceStatus;
  note?: string;
  markedBy: string;
  lessonId?: string | null;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: number;
}

// ---------------------------------------------------------------------------
// Quizzes & results
// ---------------------------------------------------------------------------

export type QuizStatus = 'draft' | 'published' | 'closed';

export interface Quiz extends BaseDoc {
  title: string;
  description?: string;
  classId: string;
  branchId?: string | null;
  teacherId?: string | null;
  lessonId?: string | null;
  language: LanguageCode;
  /** Minutes; 0 = untimed. */
  timeLimit: number;
  totalMarks: number;
  passMark: number;
  questionCount: number;
  /** Attempts allowed per student; 0 = unlimited. */
  maxAttempts: number;
  opensAt?: FireDate;
  closesAt?: FireDate;
  status: QuizStatus;
}

/** Stored at `quizzes/{quizId}/questions/{questionId}`. */
export interface Question extends BaseDoc {
  quizId: string;
  text: string;
  options: string[];
  /** Index into `options`. Never exposed to students before submission. */
  correctIndex: number;
  marks: number;
  order: number;
  explanation?: string;
}

/** Answers for one sitting of a quiz. */
export interface QuizAttempt extends BaseDoc {
  quizId: string;
  quizTitle: string;
  studentId: string;
  studentName?: string;
  classId: string;
  /** questionId -> selected option index. */
  answers: Record<string, number>;
  startedAt?: FireDate;
  submittedAt?: FireDate;
  attemptNumber: number;
  status: 'in_progress' | 'submitted';
}

export interface Result extends BaseDoc {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  studentId: string;
  studentName?: string;
  classId: string;
  branchId?: string | null;
  score: number;
  totalMarks: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  grade: string;
  passed: boolean;
  completedAt?: FireDate;
}

// ---------------------------------------------------------------------------
// Notifications & announcements
// ---------------------------------------------------------------------------

export type NotificationTarget =
  | 'all'
  | 'students'
  | 'teachers'
  | 'class'
  | 'branch'
  | 'user';

export type NotificationKind = 'immediate' | 'scheduled';

export type NotificationCategory =
  | 'general'
  | 'class_reminder'
  | 'new_lesson'
  | 'new_video'
  | 'quiz_available'
  | 'quiz_closing'
  | 'new_article'
  | 'event_reminder'
  | 'attendance_reminder'
  | 'announcement';

export interface AppNotification extends BaseDoc {
  title: string;
  message: string;
  image?: string | null;
  category: NotificationCategory;
  kind: NotificationKind;
  targetRole: NotificationTarget;
  targetClassId?: string | null;
  targetBranchId?: string | null;
  /** Set when `targetRole === 'user'`. */
  userId?: string | null;
  /** Deep link route, e.g. `/student/quiz/abc123`. */
  route?: string | null;
  scheduledAt?: FireDate;
  sentAt?: FireDate;
  status: 'draft' | 'scheduled' | 'sent' | 'failed' | 'cancelled';
  /** uids that have opened it. */
  readBy?: string[];
  deliveryNote?: string;
}

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface Announcement extends BaseDoc {
  title: string;
  message: string;
  image?: string | null;
  targetRole: NotificationTarget;
  targetClassId?: string | null;
  targetBranchId?: string | null;
  /** Set when `targetRole === 'user'`. */
  userId?: string | null;
  priority: Priority;
  publishedAt?: FireDate;
  expiresAt?: FireDate;
  status: ContentStatus;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'ACTIVATE'
  | 'DEACTIVATE'
  | 'PERMISSION_CHANGED';

export interface AuditLog extends BaseDoc {
  actorId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  action: AuditAction;
  collection: string;
  documentId?: string;
  summary: string;
  /** Field-level before/after for UPDATE actions. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  at: FireDate;
}

export interface AppLanguage extends BaseDoc {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
  enabled: boolean;
  /** Order in the language picker. */
  order: number;
}

export interface AppSettings {
  appName: string;
  tagline: string;
  /**
   * Set once here and inherited by everything created afterwards — recordings,
   * videos and calendar events all start from these. Each record then keeps its
   * own copy, so changing a default never restyles anything already published.
   */
  logoUrl?: string | null;
  faviconUrl?: string | null;
  bannerUrl?: string | null;
  /** Fallback card image when a video has no thumbnail of its own. */
  thumbnailUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string;
  contactPhone: string;
  social: {
    facebook?: string;
    youtube?: string;
    instagram?: string;
    x?: string;
    whatsapp?: string;
    website?: string;
  };
  defaultLanguage: LanguageCode;
  availableLanguages: string[];
  registrationEnabled: boolean;
  /** New student/teacher signups land in `pending` until an admin approves. */
  requireApproval: boolean;
  updatedAt?: FireDate;
  updatedBy?: string;
}

export interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  totalTeachers: number;
  activeTeachers: number;
  totalClasses: number;
  totalLessons: number;
  totalVideos: number;
  totalArticles: number;
  upcomingEvents: number;
  pendingRegistrations: number;
  notificationsSent: number;
}
