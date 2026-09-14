import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import type { AppUser, QuranBookmark } from '@/types';

/**
 * The Qur'an bookmark, kept with the ACCOUNT as well as on the device.
 *
 * It used to live on the device alone, so somebody who bookmarked a surah on
 * their phone and then opened the app on a tablet, or on a new phone, found it
 * gone. It is now written to their profile too, and a device that has none —
 * or has an older one — picks it up when they sign in.
 *
 * The device copy is read first, so opening a surah never waits on the network
 * and still works offline.
 *
 * A guest has no account to keep it in, so for a guest it stays on the device.
 */

/** Unchanged from before, so a bookmark already on a device is kept. */
export const BOOKMARK_KEY = '@weeklyclass/quran/bookmark';

function hasAccount(user: Pick<AppUser, 'uid'> | null | undefined): user is Pick<AppUser, 'uid'> {
  return Boolean(user?.uid && user.uid !== 'guest');
}

function parse(raw: string | null): QuranBookmark | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as QuranBookmark;
    return typeof value?.surah === 'number' ? value : null;
  } catch {
    return null;
  }
}

/** This device's bookmark. */
export async function loadBookmark(): Promise<QuranBookmark | null> {
  try {
    return parse(await AsyncStorage.getItem(BOOKMARK_KEY));
  } catch {
    return null;
  }
}

/**
 * Takes the account's bookmark onto this device, when it is newer.
 *
 * Newer wins, by the time it was made. A device that already holds a more
 * recent bookmark keeps it; one holding an older bookmark, or none, is brought
 * up to date. An account with no bookmark never deletes one on the device — the
 * device's may simply not have reached the account yet.
 */
export async function adoptBookmarkFromProfile(
  bookmark: QuranBookmark | null | undefined
): Promise<void> {
  if (!bookmark || typeof bookmark.surah !== 'number') return;
  try {
    const local = parse(await AsyncStorage.getItem(BOOKMARK_KEY));
    if (local && (local.at ?? 0) >= (bookmark.at ?? 0)) return;
    await AsyncStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmark));
  } catch {
    // A device that cannot store it still reads the surah; nothing to report.
  }
}

/**
 * Sets or clears the bookmark, on the device and on the account.
 *
 * The device first, so the button reflects the change at once. The account copy
 * is best effort: offline, Firestore queues it and sends it when the connection
 * returns, and a failure never takes the device copy with it.
 */
export async function saveBookmark(
  user: Pick<AppUser, 'uid'> | null | undefined,
  bookmark: QuranBookmark | null
): Promise<void> {
  try {
    if (bookmark) await AsyncStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmark));
    else await AsyncStorage.removeItem(BOOKMARK_KEY);
  } catch {
    // Carried on regardless: the account copy is still worth keeping.
  }

  if (!hasAccount(user)) return;
  try {
    await updateDoc(doc(db, COLLECTIONS.users, user.uid), {
      quranBookmark: bookmark,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('[WeeklyClass] the bookmark was kept on this device but not on the account:', error);
  }
}
