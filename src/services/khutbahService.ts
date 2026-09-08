import { COLLECTIONS } from '@/constants/app';
import type { AppUser, KhutbahEntry, KhutbahKind, LanguageCode } from '@/types';

import { createDoc, listAll, softDelete, updateDocById } from './firestore';
import { announce } from './announceService';
import * as audit from './auditService';

/**
 * Friday khutbahs and special bayans, with their translations.
 *
 * The need this answers is specific and local: the khutbah here is delivered in
 * Arabic, and a large part of the congregation reads Tamil. They can attend the
 * prayer and still not know what was said. So the centre writes the translation
 * and it is published here, alongside the recording where there is one.
 *
 * TRANSLATIONS ARE STORED, NEVER GENERATED. There is a machine translator in
 * this app and it is deliberately not wired to this screen, for the same reason
 * it is not wired to the Qur'an: a khutbah is a religious address, and a
 * machine's approximation of one presented as "the translation" would be
 * putting words into a khateeb's mouth. What is here is what somebody at this
 * centre wrote, and a language nobody has written yet simply has no translation
 * — which the screen says plainly rather than filling the gap.
 *
 * Held per language rather than as one document per translation, so the entry
 * is one thing with several renderings of it, and adding Sinhala later does not
 * create a second khutbah.
 */

export interface KhutbahQuery {
  kind?: KhutbahKind;
  publishedOnly?: boolean;
  pageSize?: number;
}

export async function listKhutbahs(options: KhutbahQuery = {}): Promise<KhutbahEntry[]> {
  return listAll<KhutbahEntry>(COLLECTIONS.khutbahs, {
    filters: [
      options.kind ? ['kind', '==', options.kind] : null,
      options.publishedOnly ? ['status', '==', 'published'] : null,
    ],
    orderByField: 'date',
    direction: 'desc',
    pageSize: options.pageSize ?? 40,
  }).catch((error) => {
    console.warn('[WeeklyClass] could not list khutbahs:', error);
    return [];
  });
}

/**
 * Which languages this entry has actually been translated into.
 *
 * A key present but empty is not a translation — somebody opened the box and
 * did not fill it — so it is not offered.
 */
export function availableLanguages(entry: KhutbahEntry): LanguageCode[] {
  const translations = entry.translations ?? {};
  return (Object.keys(translations) as LanguageCode[]).filter(
    (code) => (translations[code] ?? '').trim().length > 0
  );
}

/**
 * The best rendering for a reader, and what it actually is.
 *
 * Falls back to the language it was delivered in rather than to nothing,
 * because a Tamil reader who finds no Tamil translation is still better served
 * by the Arabic original than by an empty screen. The caller is told which
 * language came back so it can say so; silently showing Arabic to somebody who
 * asked for Tamil would look like a bug.
 */
export function renderingFor(
  entry: KhutbahEntry,
  preferred: LanguageCode
): { language: LanguageCode; text: string } | null {
  const translations = entry.translations ?? {};

  const wanted = (translations[preferred] ?? '').trim();
  if (wanted) return { language: preferred, text: wanted };

  const delivered = (translations[entry.deliveredIn] ?? '').trim();
  if (delivered) return { language: entry.deliveredIn, text: delivered };

  const first = availableLanguages(entry)[0];
  return first ? { language: first, text: (translations[first] ?? '').trim() } : null;
}

export async function saveKhutbah(
  data: Partial<KhutbahEntry> & { title: string; kind: KhutbahKind },
  actor: AppUser,
  id?: string
): Promise<string> {
  const payload = {
    status: 'published' as const,
    deliveredIn: 'ar' as LanguageCode,
    ...data,
  };

  if (id) {
    await updateDocById<KhutbahEntry>(COLLECTIONS.khutbahs, id, payload);
    await audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.khutbahs,
      documentId: id,
      summary: `Updated the ${payload.kind} "${payload.title}"`,
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.khutbahs, payload, { actorId: actor.uid });

  // Publishing a translation is the whole point of writing one, so the people
  // waiting for it are told. A draft announces nothing.
  void announce(
    {
      kind: 'khutbah',
      title: payload.title,
      published: payload.status === 'published',
    },
    actor
  );

  await audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.khutbahs,
    documentId: newId,
    summary: `Published the ${payload.kind} "${payload.title}"`,
  });
  return newId;
}

export async function deleteKhutbah(id: string, actor: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.khutbahs, id, actor.uid);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.khutbahs,
    documentId: id,
    summary: 'Removed a khutbah entry',
  });
}
