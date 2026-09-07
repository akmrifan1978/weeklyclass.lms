import type { AppSettings, LanguageCode } from '@/types';

export const APP_NAME = 'WeeklyClass LMS';
export const APP_TAGLINE = 'Empowering Islamic Learning Through Technology';
export const APP_SHORT_NAME = 'WeeklyClass';

/** Firestore collection names — referenced everywhere, never typed by hand. */
export const COLLECTIONS = {
  users: 'users',
  usernames: 'usernames',
  organizations: 'organizations',
  countries: 'countries',
  branches: 'branches',
  classes: 'classes',
  subjects: 'subjects',
  lessons: 'lessons',
  videos: 'videos',
  articles: 'articles',
  materials: 'materials',
  attendance: 'attendance',
  quizzes: 'quizzes',
  questions: 'questions',
  quizAttempts: 'quizAttempts',
  results: 'results',
  calendarEvents: 'calendarEvents',
  notifications: 'notifications',
  supportRequests: 'supportRequests',
  qaQuestions: 'qaQuestions',
  eventRegistrations: 'eventRegistrations',
  announcements: 'announcements',
  languages: 'languages',
  settings: 'settings',
  auditLogs: 'auditLogs',
  counters: 'counters',
  notes: 'notes',
} as const;

/** `settings/{APP_SETTINGS_DOC}` holds the single global settings document. */
export const APP_SETTINGS_DOC = 'app';

export const DEFAULT_SETTINGS: AppSettings = {
  appName: APP_NAME,
  tagline: APP_TAGLINE,
  venue: '',
  logoUrl: null,
  faviconUrl: null,
  bannerUrl: null,
  thumbnailUrl: null,
  primaryColor: '#092F6B',
  secondaryColor: '#ED5B03',
  supportEmail: 'support@weeklyclass.app',
  contactPhone: '',
  social: {},
  defaultLanguage: 'en',
  availableLanguages: ['en', 'ta', 'si', 'ar'],
  registrationEnabled: true,
  requireApproval: true,
  // Off: an organiser who set up bookings did so to see who is coming, and
  // silently confirming everyone would take that decision away from them.
  autoApproveEventBookings: false,
  tickerEnabled: false,
  tickerText: '',
  qaScholarName: '',
  // Off: an id the student has not been given yet is a wall in front of the
  // first screen they ever see.
  requireClassId: false,
  classGroups: ['Children', 'Teenagers', 'Adults'],
  eventNames: [],
  // Off by default. A timeout that logs people out mid-lesson is worse than no
  // timeout at all unless somebody has actually asked for one.
  sessionTimeoutMinutes: 0,
  // All on by default. An admin switching one off is a deliberate act; a fresh
  // install finding them all hidden would just look broken.
  islamicFeatures: {
    prayer: true,
    quran: true,
    readingPlan: true,
    tajweed: true,
    zakat: true,
    hadith: true,
    dua: true,
  },
};

/** Every Islamic section, in the order they appear on a dashboard. */
export const ISLAMIC_FEATURES = [
  'prayer',
  'quran',
  'readingPlan',
  'tajweed',
  'zakat',
  'hadith',
  'dua',
] as const;

export interface LanguageOption {
  code: LanguageCode;
  name: string;
  nativeName: string;
  rtl: boolean;
}

/**
 * Bundled languages. The app also reads `languages/*` from Firestore so admins
 * can enable/disable and add more without shipping a new build — see
 * `languageService.ts`.
 */
export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English', rtl: false },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', rtl: false },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', rtl: false },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** Firestore page sizes. Never fetch an unbounded collection. */
export const PAGE_SIZE = 20;
export const PAGE_SIZE_LARGE = 50;

export const GRADE_BANDS: { min: number; grade: string }[] = [
  { min: 90, grade: 'A+' },
  { min: 80, grade: 'A' },
  { min: 70, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 50, grade: 'D' },
  { min: 0, grade: 'F' },
];

export const STORAGE_KEYS = {
  language: '@weeklyclass/language',
  lastRoleTab: '@weeklyclass/last-role',
  onboarded: '@weeklyclass/onboarded',
  cachedProfile: '@weeklyclass/cached-profile',
} as const;

/** Upload guards — Firebase Storage free tier is 5 GB total, 1 GB/day egress. */
export const UPLOAD_LIMITS = {
  imageBytes: 3 * 1024 * 1024,
  documentBytes: 15 * 1024 * 1024,
  audioBytes: 25 * 1024 * 1024,
};
