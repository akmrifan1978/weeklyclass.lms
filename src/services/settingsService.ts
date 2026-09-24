import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { APP_SETTINGS_DOC, COLLECTIONS, DEFAULT_SETTINGS } from '@/constants/app';
import type { AppSettings, AppUser } from '@/types';
import * as audit from './auditService';

/**
 * Global app settings, stored in the single document `settings/app`.
 * Readable by everyone (the splash screen needs the app name and language list
 * before anyone signs in); writable only by admins.
 */

let cache: AppSettings | null = null;

export async function getSettings(force = false): Promise<AppSettings> {
  if (cache && !force) return cache;
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.settings, APP_SETTINGS_DOC));
    cache = snap.exists()
      ? { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<AppSettings>) }
      : DEFAULT_SETTINGS;
  } catch {
    // Offline or rules not deployed yet — the app must still boot.
    cache = cache ?? DEFAULT_SETTINGS;
  }
  return cache;
}

export function watchSettings(onNext: (settings: AppSettings) => void): () => void {
  return onSnapshot(
    doc(db, COLLECTIONS.settings, APP_SETTINGS_DOC),
    (snap) => {
      cache = snap.exists()
        ? { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<AppSettings>) }
        : DEFAULT_SETTINGS;
      onNext(cache);
    },
    () => onNext(cache ?? DEFAULT_SETTINGS)
  );
}

export async function updateSettings(
  changes: Partial<AppSettings>,
  actor: AppUser
): Promise<void> {
  const before = await getSettings(true);
  await setDoc(
    doc(db, COLLECTIONS.settings, APP_SETTINGS_DOC),
    { ...changes, updatedAt: serverTimestamp(), updatedBy: actor.uid },
    { merge: true }
  );
  cache = { ...before, ...changes };

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.settings,
    documentId: APP_SETTINGS_DOC,
    summary: 'Updated app settings',
    changes: audit.diff(before as unknown as Record<string, unknown>, changes),
  });
}

/** Creates the settings document on first run. Safe to call repeatedly. */
export async function ensureSettings(): Promise<void> {
  const ref = doc(db, COLLECTIONS.settings, APP_SETTINGS_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...DEFAULT_SETTINGS, updatedAt: serverTimestamp() });
  }
}

export function clearSettingsCache(): void {
  cache = null;
}
