import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { TOTAL_JUZ, TOTAL_PAGES, locateAyah } from './quranService';

/**
 * A daily Qur'an reading plan.
 *
 * Progress is counted in PAGES, even though a plan is set by surah and ayah.
 * That is the unit every target shares — one page, five pages and a juz are all
 * page counts — and it is what makes "continue from where you stopped" a single
 * number rather than a surah-and-ayah cursor that has to be walked forward.
 *
 * The device is the source of truth. Reading happens wherever the person is,
 * often with no connection, and a plan that could not be marked complete offline
 * would be worse than useless. The profile copy is a mirror so the plan survives
 * a new device; it is written best-effort and never blocks anything.
 */

const STORAGE_KEY = '@weeklyclass/quran-plan';
const REMINDER_ID_KEY = '@weeklyclass/quran-plan-reminder';

/** Daily targets, in pages. A juz is a twentieth of the mushaf, near enough. */
export const DAILY_TARGETS = [1, 2, 5, 20] as const;
export type DailyTarget = (typeof DAILY_TARGETS)[number];

/** Pages in one juz — 604 pages over 30 juz, rounded to the usual 20. */
export const PAGES_PER_JUZ = 20;

export interface ReadingEntry {
  /** ISO date, `YYYY-MM-DD`. One entry per completed day. */
  date: string;
  fromPage: number;
  toPage: number;
  pages: number;
}

export interface ReadingPlan {
  /** Where the plan begins, as the person described it. */
  startSurah: number;
  startAyah: number;
  /** Optional end of the range; null means "to the end of the mushaf". */
  endSurah: number | null;
  endAyah: number | null;

  startPage: number;
  endPage: number;
  /** The next page to read. Advances only when a day is marked complete. */
  currentPage: number;

  dailyPages: DailyTarget;
  reminderEnabled: boolean;
  /** Local time of the daily reminder, `HH:mm`. */
  reminderTime: string;
  audioEnabled: boolean;

  history: ReadingEntry[];
  createdAt: string;
}

/** How much history is kept. A season of reading is plenty to look back on. */
const HISTORY_LIMIT = 120;

export function todayIso(date: Date = new Date()): string {
  // Built from local parts, not toISOString(): the reading day is the person's
  // own day, and UTC would roll over at the wrong moment for every reader east
  // or west of Greenwich.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function loadPlan(): Promise<ReadingPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReadingPlan) : null;
  } catch {
    return null;
  }
}

async function persist(plan: ReadingPlan, uid?: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // The plan still applies for this session.
  }
  if (uid) void mirrorToProfile(uid, plan);
}

/**
 * Mirrors the plan onto the profile so it survives a new device.
 *
 * Silent on failure by design. The device copy is what every screen reads, and a
 * refused or offline write must never stop someone marking a day's reading done.
 */
async function mirrorToProfile(uid: string, plan: ReadingPlan): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      quranPlan: plan,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Nothing to do.
  }
}

/** Adopts a plan found on the profile when the device has none of its own. */
export async function adoptFromProfile(plan: ReadingPlan | undefined): Promise<void> {
  if (!plan) return;
  const existing = await loadPlan();
  if (existing) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // ignore
  }
}

export async function createPlan(
  input: {
    startSurah: number;
    startAyah: number;
    endSurah: number | null;
    endAyah: number | null;
    dailyPages: DailyTarget;
    reminderEnabled: boolean;
    reminderTime: string;
    audioEnabled: boolean;
  },
  uid?: string | null
): Promise<ReadingPlan> {
  const start = await locateAyah(input.startSurah, input.startAyah);
  const end =
    input.endSurah != null && input.endAyah != null
      ? await locateAyah(input.endSurah, input.endAyah)
      : { page: TOTAL_PAGES };

  const plan: ReadingPlan = {
    ...input,
    startPage: start.page,
    // A range that ends before it begins is a typo, not an instruction. Reading
    // to the end of the mushaf is the sane reading of it.
    endPage: Math.max(start.page, end.page),
    currentPage: start.page,
    history: [],
    createdAt: new Date().toISOString(),
  };

  await persist(plan, uid);
  await syncReminder(plan);
  return plan;
}

export async function updatePlan(
  plan: ReadingPlan,
  changes: Partial<ReadingPlan>,
  uid?: string | null
): Promise<ReadingPlan> {
  const next = { ...plan, ...changes };
  await persist(next, uid);
  await syncReminder(next);
  return next;
}

export async function deletePlan(uid?: string | null): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  await cancelReminder();
  if (uid) {
    void updateDoc(doc(db, COLLECTIONS.users, uid), {
      quranPlan: null,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }
}

/**
 * The pages this screen should show today.
 *
 * Once today is marked complete this is what was READ today, not what comes
 * next. The cursor has already moved on by then, so showing it would put
 * tomorrow's pages on screen under a "Completed" badge — claiming credit for
 * reading that has not happened, and hiding what the person actually read.
 * Tomorrow's starting page is reported separately, on the progress card.
 */
export function todaysPages(plan: ReadingPlan): number[] {
  const today = plan.history.find((entry) => entry.date === todayIso());
  const first = today ? today.fromPage : plan.currentPage;
  const last = today
    ? today.toPage
    : Math.min(plan.currentPage + plan.dailyPages - 1, plan.endPage);

  const pages: number[] = [];
  for (let page = first; page <= last; page += 1) pages.push(page);
  return pages;
}

export function isFinished(plan: ReadingPlan): boolean {
  return plan.currentPage > plan.endPage;
}

export function completedToday(plan: ReadingPlan): boolean {
  return plan.history.some((entry) => entry.date === todayIso());
}

/**
 * Records today's reading and moves the cursor on.
 *
 * Marking twice on the same day is a no-op rather than an error: it is far more
 * likely to be a double tap than a genuine second reading, and silently skipping
 * a day's worth of pages would be the more damaging of the two mistakes.
 */
export async function markComplete(
  plan: ReadingPlan,
  uid?: string | null
): Promise<ReadingPlan> {
  if (completedToday(plan) || isFinished(plan)) return plan;

  const pages = todaysPages(plan);
  if (pages.length === 0) return plan;

  const entry: ReadingEntry = {
    date: todayIso(),
    fromPage: pages[0],
    toPage: pages[pages.length - 1],
    pages: pages.length,
  };

  const next: ReadingPlan = {
    ...plan,
    currentPage: pages[pages.length - 1] + 1,
    history: [entry, ...plan.history].slice(0, HISTORY_LIMIT),
  };

  await persist(next, uid);
  return next;
}

/** Undoes today's entry, for a day marked done by mistake. */
export async function undoToday(
  plan: ReadingPlan,
  uid?: string | null
): Promise<ReadingPlan> {
  const today = plan.history.find((entry) => entry.date === todayIso());
  if (!today) return plan;

  const next: ReadingPlan = {
    ...plan,
    currentPage: today.fromPage,
    history: plan.history.filter((entry) => entry.date !== todayIso()),
  };
  await persist(next, uid);
  return next;
}

export interface PlanProgress {
  pagesRead: number;
  pagesTotal: number;
  percent: number;
  juzRead: number;
  juzTotal: number;
  surahsCompleted: number;
  daysRead: number;
  /** Consecutive days up to and including today (or yesterday, mid-streak). */
  streak: number;
}

export function progressFor(plan: ReadingPlan, surahsPassed: number): PlanProgress {
  const pagesTotal = plan.endPage - plan.startPage + 1;
  const pagesRead = Math.min(plan.currentPage - plan.startPage, pagesTotal);

  return {
    pagesRead,
    pagesTotal,
    percent: pagesTotal > 0 ? Math.round((pagesRead / pagesTotal) * 100) : 0,
    juzRead: Math.floor((plan.currentPage - 1) / PAGES_PER_JUZ),
    juzTotal: TOTAL_JUZ,
    surahsCompleted: surahsPassed,
    daysRead: plan.history.length,
    streak: streakFor(plan.history),
  };
}

/**
 * Consecutive reading days, counted back from today.
 *
 * A streak that is intact but not yet extended today still counts — being told
 * your streak is broken at breakfast because you have not read yet would be both
 * wrong and discouraging.
 */
export function streakFor(history: ReadingEntry[]): number {
  if (history.length === 0) return 0;

  const dates = new Set(history.map((entry) => entry.date));
  const cursor = new Date();
  if (!dates.has(todayIso(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (dates.has(todayIso(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Daily reminder
// ---------------------------------------------------------------------------

/**
 * Schedules, reschedules or cancels the daily reminder to match the plan.
 *
 * A local notification, not a push: it needs no server, no token and no billing,
 * and it fires whether or not the phone has a connection — which is exactly the
 * behaviour a daily reading reminder wants.
 */
export async function syncReminder(plan: ReadingPlan): Promise<void> {
  await cancelReminder();
  if (!plan.reminderEnabled || Platform.OS === 'web') return;

  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return;
    }

    const [hours, minutes] = plan.reminderTime.split(':').map(Number);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Daily Qur’an reading',
        body: `Today: ${plan.dailyPages} page${plan.dailyPages === 1 ? '' : 's'}.`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Number.isFinite(hours) ? hours : 6,
        minute: Number.isFinite(minutes) ? minutes : 0,
      },
    });
    await AsyncStorage.setItem(REMINDER_ID_KEY, id).catch(() => undefined);
  } catch {
    // A reminder that cannot be scheduled must not break the plan itself.
  }
}

export async function cancelReminder(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(REMINDER_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(REMINDER_ID_KEY);
    }
  } catch {
    // ignore
  }
}

/** True where a scheduled reminder can actually fire. */
export function remindersSupported(): boolean {
  return Platform.OS !== 'web';
}
