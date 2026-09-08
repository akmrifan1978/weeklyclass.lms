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

/** The age bands classes are organised into. */
export type AgeBand = 'children' | 'teenagers' | 'adults';

/**
 * Who a class group is for.
 *
 * `mixed` exists because not every group is separated — a lecture open to
 * everybody is a real thing — and because a class created before this field
 * existed has no answer to the question. Making the absence explicit is better
 * than defaulting it to one of the two and quietly mis-sorting people.
 */
export type ClassGender = 'male' | 'female' | 'mixed';

export interface ClassRoom extends BaseDoc {
  name: string;
  code?: string;
  description?: string;
  /**
   * The two axes a class group is organised by, alongside its name.
   *
   * They are kept as their own fields rather than parsed out of the name so
   * they can be filtered on — the registration screen shows a student only the
   * groups matching the gender they gave, and a teacher's list is scoped the
   * same way. A name like "Children - Male" is for people to read; these are
   * for the app to reason about.
   */
  ageBand?: AgeBand;
  gender?: ClassGender;
  branchId: string;
  organizationId?: string;
  /** Primary teacher. */
  teacherId?: string | null;
  /** All teachers permitted to act on this class. */
  teacherIds: string[];
  /**
   * Their names, copied onto the group.
   *
   * Denormalised for one specific reason: the registration screen has to name
   * the teachers a student is about to be assigned to, and it runs signed out
   * — it cannot read the users collection, and it should not be able to. The
   * names are written here whenever the group is saved, so the one screen that
   * needs them can have them without opening up everything else about a
   * teacher to the public.
   */
  teacherNames?: string[];
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
  /**
   * Town or country, kept apart from the venue.
   *
   * "Jeddah Dawah Center" and "Jeddah, Saudi Arabia" answer different questions —
   * one names the room, the other places it — and squeezing both into one field
   * makes it useless for grouping by either.
   */
  location?: string;
  /** Subject of the session, used for grouping and search. */
  topic?: string;
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
  /**
   * Where imported content came from. binbaz.org.sa permits copying "on
   * condition that the source is cited", so for anything imported from there
   * these are not decoration — the attribution is the licence, and the screen
   * that shows the content shows them too.
   */
  sourceUrl?: string | null;
  sourceName?: string | null;
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

/**
 * Whether an event is open for booking, and on what terms.
 *
 * `openingSoon` exists because announcing an event before booking opens is the
 * normal way these are run — people need to know it is coming and put the date
 * aside. Without it the choice is to hide the event or to let people book before
 * anyone is ready to take payment.
 */
export type RegistrationStatus = 'openingSoon' | 'open' | 'closed';

/**
 * Age bands, because a family books together and a coach seat for a babe in
 * arms is not the same product as one for an adult.
 */
export type AgeGroup = 'infant' | 'child' | 'teenage' | 'adult';

export type Gender = 'male' | 'female';

export const AGE_GROUPS: AgeGroup[] = ['infant', 'child', 'teenage', 'adult'];

export interface EventRegistrationSettings {
  status: RegistrationStatus;
  /** Null means unlimited; a number is a hard cap the booking honours. */
  capacity: number | null;
  /**
   * The default price per person. Used for any age group with no price of its
   * own, and as the only price when the organiser has not set bands.
   */
  price: number;
  /**
   * Price per age band. Absent groups fall back to `price`, so an organiser who
   * only wants to make infants free sets that one number and nothing else.
   */
  pricesByAgeGroup?: Partial<Record<AgeGroup, number>>;
  currency: string;
  /**
   * Label for an extra reference the organiser needs from each booking — a
   * Nusuk number for an Umrah trip, a passport number for a coach crossing a
   * border. Absent means the field is not shown at all.
   */
  referenceLabel?: string | null;
  /** Shown in place of the usual "registration closed" wording. */
  note?: string | null;
}

/**
 * One named person on a booking.
 *
 * Stored rather than counted, because an organiser chartering a bus needs the
 * names, and a headcount cannot be turned back into one.
 */
export interface EventParticipant {
  name: string;
  gender: Gender;
  ageGroup: AgeGroup;
  /** What this person was charged, frozen at booking time. */
  price: number;
}

/** One person's booking. Lives in its own collection; see supportService. */
export interface EventRegistration extends BaseDoc {
  eventId: string;
  eventTitle: string;
  userId: string;
  userName: string;
  userMobile?: string | null;
  userEmail?: string | null;
  /**
   * Everyone on this booking, the person who made it included.
   *
   * The first entry is always the booker, so a list of attendees reads in the
   * order a family would present itself at the door.
   */
  participants: EventParticipant[];
  /** Seats taken — the number of participants, kept for querying and sorting. */
  seats: number;
  /** The sum of the participants' prices, frozen at booking time so a later
   *  price change is not applied retrospectively to someone who already paid. */
  amount: number;
  /** Whatever `referenceLabel` asked for, if anything. */
  reference?: string | null;
  currency: string;
  /**
   * A booking is requested, not granted.
   *
   * `pending` still holds the seats — an organiser deciding overnight must not
   * find the event oversold by morning — but it is not yet a ticket. Only once
   * an admin confirms does the booker get something to show at the door.
   */
  status: BookingStatus;
  /** When it was confirmed, and by whom. Absent while pending. */
  confirmedAt?: unknown;
  confirmedBy?: string | null;
  /** When a pending request was declined, by whom, and why. */
  rejectedAt?: unknown;
  rejectedBy?: string | null;
  /**
   * Shown to the person who asked. Optional, and worth writing: "the hall is
   * full" and "we could not reach you" are different answers, and neither is
   * conveyed by the word "rejected" on its own.
   */
  rejectionReason?: string | null;
  /** Set by an admin once payment is in hand. */
  paid?: boolean;
  notes?: string | null;
}

/**
 * Where a booking stands.
 *
 *  confirmed — there was room, the place is theirs, the ticket exists.
 *  pending   — asked for, not granted. Either the event was already full when
 *              they asked, or the organiser reviews every booking by hand.
 *  rejected  — the organiser considered a pending request and declined it.
 *  cancelled — it was granted and then given up, by either side.
 *
 * `rejected` is deliberately distinct from `cancelled`. One is a decision made
 * about somebody, the other is a place released, and a list that renders them
 * the same cannot tell an organiser who they still owe an answer to.
 *
 * None of these says anything about money — see `paid`. A confirmed booking is
 * a place held, not a payment received.
 */
export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface CalendarEvent extends BaseDoc {
  title: string;
  description?: string;
  /** ISO date `YYYY-MM-DD` — queryable and timezone-stable for day grouping. */
  date: string;
  /** `HH:mm` 24h. */
  startTime: string;
  endTime: string;
  /** Venue name, for a session that also has a physical room. */
  venue?: string;
  /** Town or country — see the note on VideoItem.location. */
  location?: string;
  /** Subject of the session. */
  topic?: string;
  speaker?: string;
  /** Kept for events created before sessions could have several teachers. */
  teacherId?: string | null;
  /**
   * Everyone conducting this session.
   *
   * A class here is often taught by more than one person at once — a lead and a
   * second for the girls' side, or two teachers splitting a long session — so
   * this is a list, not a single id. `teacherId` above remains the first entry
   * for anything created before this existed.
   */
  teacherIds?: string[];

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

  // --- Registration -------------------------------------------------------
  //
  // Absent on an ordinary calendar entry. An event only takes bookings once
  // `registration` is set, which keeps a class reminder and a ticketed family
  // gathering in one collection without one pretending to be the other.
  registration?: EventRegistrationSettings;
  /**
   * How many seats are taken.
   *
   * Denormalised onto the event so a list of twenty events costs twenty reads
   * rather than twenty aggregate queries. It is maintained by the booking
   * transaction, which is the only thing that may change it.
   */
  registeredCount?: number;
  branchId?: string | null;
  classId?: string | null;
  targetAudience: AudienceRole;
  /** Precomputed for ordering/queries: `date` + `startTime` as a real instant. */
  startsAt: FireDate;
  status: 'scheduled' | 'cancelled' | 'completed';
}

// ---------------------------------------------------------------------------
// Support, feedback and Q&A
// ---------------------------------------------------------------------------

/**
 * What someone is writing in about. One collection rather than four, because a
 * complaint and a piece of feedback need exactly the same handling — reach the
 * admin, get a reply, be closed — and splitting them would give the admin four
 * inboxes to remember to check.
 */
export type SupportKind =
  | 'feedback'
  | 'complaint'
  | 'question'
  | 'contact'
  // The one kind that can be filed by somebody who is NOT signed in — that is
  // the whole point of it. See the rule and supportService.requestPasswordHelp.
  | 'passwordHelp';

export type SupportStatus = 'open' | 'answered' | 'closed';

export interface SupportRequest extends BaseDoc {
  kind: SupportKind;
  subject: string;
  message: string;
  /**
   * Who wrote it. Kept denormalised so the inbox needs no second read.
   *
   * Null for a `passwordHelp` request, which by definition comes from somebody
   * who could not sign in: there is no uid or role to record, and `userName` is
   * whatever they typed at the login box for an admin to match by hand.
   */
  userId: string | null;
  userName: string;
  userRole: UserRole | null;
  userMobile?: string | null;
  classId?: string | null;
  branchId?: string | null;
  status: SupportStatus;
  /**
   * A star rating, 1-5, on a `feedback` request only.
   *
   * Kept beside the message rather than in a collection of its own, because a
   * rating without the sentence explaining it is a number nobody can act on,
   * and the two arrive together.
   */
  rating?: number | null;
  /**
   * The language it was written in, as the writer said so themselves.
   *
   * Not guessed from the text. It is recorded so the inbox can say what an
   * admin is about to read before they read it, and so a message in a language
   * they do not have can be offered for translation rather than left as a
   * paragraph they will quietly skip.
   */
  language?: LanguageCode | null;
  /** The admin's reply, visible to the person who wrote in. */
  reply?: string | null;
  repliedBy?: string | null;
  repliedByName?: string | null;
  repliedAt?: FireDate | null;
}

/**
 * A question asked in the open, for a class to see — not the same thing as a
 * support request, which is private between one person and the admin. Answers
 * here are teaching, so everyone in the class benefits from reading them.
 */
export interface QaQuestion extends BaseDoc {
  question: string;
  /**
   * A spoken question, uploaded alongside (or instead of) the text.
   *
   * Typing Tamil or Arabic on a phone is slow, and someone who reads more
   * easily than they write should still be able to ask. The text field stays
   * required as a short label so the list is scannable and searchable —
   * a wall of unlabelled play buttons is not a question list.
   */
  audioUrl?: string | null;
  audioSeconds?: number | null;
  askedBy: string;
  askedByName: string;
  classId?: string | null;
  /** Optionally tied to the online class it was asked during. */
  eventId?: string | null;
  answer?: string | null;
  /** A spoken answer. Teachers benefit from this at least as much as students. */
  answerAudioUrl?: string | null;
  answerAudioSeconds?: number | null;
  answeredBy?: string | null;
  answeredByName?: string | null;
  answeredAt?: FireDate | null;
  status: 'open' | 'answered';
  /** Staff can hide a question without deleting what someone wrote. */
  hidden?: boolean;
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
  /**
   * An admin answering something one person wrote in.
   *
   * Its own category rather than 'general' because it is addressed to one
   * student about one thing they asked, and because the rules distinguish a
   * broadcast somebody composed from the automatic tail of an action they were
   * already allowed to take.
   */
  | 'support_reply'
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

/**
 * Which calendar the app prints dates in. See `utils/hijri.ts`.
 *
 * `both` shows the Gregorian date with the Hijri one beside it, which is what
 * most people here actually want: one date to act on, one to place it in the
 * Islamic year.
 */
export type CalendarSystem = 'gregorian' | 'hijri' | 'both';

export interface AppSettings {
  appName: string;
  tagline: string;
  /**
   * Where the platform is run from, shown on the sign-in screen beneath the
   * name — e.g. "Jeddah Dawah Center – Tamil Section".
   *
   * Deliberately part of the identity rather than the contact block: it tells
   * someone opening the app for the first time whose platform this is, which
   * matters most on the one screen they see before signing in.
   */
  venue?: string;
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
  /**
   * Holds EVERY booking for review, even when there is obviously room.
   *
   * Off by default, and off is the behaviour most events want: a booking with
   * seats available confirms itself and the ticket appears at once, while one
   * made against a full event waits as a request for the organiser to accept or
   * decline. Turning this on removes the first half — nothing self-confirms,
   * and every booking is a request.
   */
  requireBookingApproval?: boolean;
  /**
   * A line of text scrolling above the bottom menu on every screen.
   *
   * Its point is that it needs no release: an announcement, a term date, a
   * closure, typed here and live on every phone the next time the app opens.
   */
  tickerEnabled?: boolean;
  tickerText?: string;
  /**
   * Who answers in Live Q&A, shown as "Live Q&A with …".
   *
   * A setting rather than a constant because the scholar changes and the app
   * should not need a release when they do.
   */
  qaScholarName?: string;
  /**
   * Whether a student must supply a class id to register.
   *
   * Off where classes are assigned afterwards by an admin, which is most
   * places — asking somebody for an id they have not been given yet is a wall
   * in front of the first screen they ever see.
   */
  requireClassId?: boolean;
  /** Named groups offered when registering and when setting assignments. */
  classGroups?: string[];
  /** Event name presets, so recurring events are typed once. */
  eventNames?: string[];
  /**
   * A contact address given to the translation service, which raises the free
   * daily allowance roughly tenfold.
   *
   * Optional, and everything works without it — there is simply less translated
   * per day before the limit is reached. It is a setting rather than a constant
   * because it is the organisation's own address being handed to a third party,
   * which is theirs to decide rather than ours.
   */
  translationContactEmail?: string;
  /**
   * Minutes of inactivity before a session is ended, or 0 to never end one.
   *
   * The phones this runs on are shared — a family tablet, a classroom device —
   * so an abandoned session is a real exposure, not a theoretical one.
   */
  sessionTimeoutMinutes?: number;
  /**
   * Which Islamic sections are switched on, platform-wide.
   *
   * The same set is offered to students, teachers and admins alike — these are
   * for the person, not tools tied to a role — so the admin decides once here
   * rather than per role. Absent means on: a platform that upgrades into this
   * release should not silently lose sections it was already showing.
   */
  islamicFeatures?: Partial<Record<IslamicFeature, boolean>>;
  /**
   * Which calendar dates are printed in, everywhere at once.
   *
   * Organisation-wide rather than per person, because a date on a ticket, a
   * poster and a lesson card has to be the same date in every conversation
   * about it. See `utils/hijri.ts` for what the Hijri date is and is not.
   */
  calendarSystem?: CalendarSystem;
  updatedAt?: FireDate;
  updatedBy?: string;
}

/** The optional Islamic sections an admin can switch on or off. */
/** A Friday sermon, or a talk given on some other occasion. */
export type KhutbahKind = 'jumuah' | 'bayan';

/**
 * A khutbah or bayan and the translations of it this centre has written.
 *
 * `translations` is keyed by language and holds only what somebody actually
 * wrote — see khutbahService for why nothing here is ever machine-generated.
 */
export interface KhutbahEntry extends BaseDoc {
  kind: KhutbahKind;
  title: string;
  /** ISO date of the sermon or talk, not of the record. */
  date: string;
  speaker?: string | null;
  venue?: string | null;
  /** The language it was actually delivered in. Usually Arabic here. */
  deliveredIn: LanguageCode;
  /** Language code to the written translation. Absent means not translated. */
  translations?: Partial<Record<LanguageCode, string>>;
  /**
   * A recording, where one exists.
   *
   * Two fields because they are two different things. `audioUrl` is a link
   * somebody pasted — YouTube, Drive, anywhere — and costs this project
   * nothing. `mediaUrl` is a file uploaded through the app, which is the only
   * option when the recording exists solely on the phone in somebody's hand.
   * Either may be present; the screen offers whichever there is.
   */
  audioUrl?: string | null;
  mediaUrl?: string | null;
  mediaType?: 'audio' | 'video' | null;
  status: ContentStatus;
}

export type IslamicFeature =
  | 'prayer'
  | 'names'
  | 'khutbah'
  | 'quran'
  | 'readingPlan'
  | 'tajweed'
  | 'zakat'
  | 'hadith'
  | 'dua';

/**
 * A private note, belonging to exactly one person.
 *
 * Not shared, not visible to staff, and not part of any report. Somebody
 * listening to a lesson wants somewhere to write "ask about this" without
 * composing a message to anybody — the value is that nobody else reads it, and
 * the rules enforce that rather than the screen.
 */
export interface Note extends BaseDoc {
  userId: string;
  title: string;
  body: string;
  /** Kept at the top of the list until unpinned. */
  pinned?: boolean;
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
