import { COLLECTIONS, LANGUAGES } from '@/constants/app';
import { resources } from '@/i18n';
import { AppError } from '@/utils/errors';
import type { AppLanguage, AppUser } from '@/types';
import { countWhere, hardDelete, listAll, setDocById, updateDocById } from './firestore';
import * as audit from './auditService';

/**
 * Language registry.
 *
 * Translation strings are bundled with the app (src/i18n/locales), but which
 * languages are *offered* is data, so an admin can turn one on or off without a
 * release. Adding a genuinely new language still needs a locale file — that is
 * documented in docs/I18N.md.
 */

export async function listLanguages(enabledOnly = true): Promise<AppLanguage[]> {
  try {
    const rows = await listAll<AppLanguage>(COLLECTIONS.languages, {
      filters: [enabledOnly ? ['enabled', '==', true] : null],
      orderByField: 'order',
      direction: 'asc',
      pageSize: 50,
    });
    if (rows.length > 0) return rows;
  } catch {
    // Rules not deployed or offline — fall through to the bundled list.
  }
  return fallbackLanguages();
}

/** The bundled languages, shaped like Firestore rows. */
export function fallbackLanguages(): AppLanguage[] {
  return LANGUAGES.map((language, index) => ({
    id: language.code,
    code: language.code,
    name: language.name,
    nativeName: language.nativeName,
    rtl: language.rtl,
    enabled: true,
    order: index,
  }));
}

/** Seeds `languages/*` with the bundled set. Safe to run repeatedly. */
export async function ensureLanguages(actor?: AppUser): Promise<void> {
  await Promise.all(
    LANGUAGES.map((language, index) =>
      setDocById(
        COLLECTIONS.languages,
        language.code,
        {
          code: language.code,
          name: language.name,
          nativeName: language.nativeName,
          rtl: language.rtl,
          enabled: true,
          order: index,
        },
        { actorId: actor?.uid }
      )
    )
  );
}

export async function setEnabled(
  code: string,
  enabled: boolean,
  actor: AppUser
): Promise<void> {
  await updateDocById<AppLanguage>(COLLECTIONS.languages, code, { enabled });
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.languages,
    documentId: code,
    summary: `${enabled ? 'Enabled' : 'Disabled'} language ${code}`,
  });
}

/**
 * Adds or edits a language.
 *
 * The code is the document id, so it cannot be changed on an existing row —
 * every user profile stores a language code, and renaming one would orphan all
 * of them. Adding a language makes it selectable; it does NOT create interface
 * translations, which ship with the app, so an added language falls back to
 * English until `src/i18n/locales/<code>.json` exists. The screen says so.
 */
export async function saveLanguage(
  data: { code: string; name: string; nativeName: string; rtl: boolean; order: number },
  actor: AppUser,
  isNew: boolean
): Promise<void> {
  const code = data.code.trim().toLowerCase();

  await setDocById<Partial<AppLanguage>>(
    COLLECTIONS.languages,
    code,
    {
      code,
      name: data.name.trim(),
      nativeName: data.nativeName.trim(),
      rtl: data.rtl,
      order: data.order,
      // A new language starts disabled. Enabling it is a separate, deliberate
      // act, so nobody adds a row and accidentally offers an untranslated
      // interface to every student at once.
      ...(isNew ? { enabled: false } : {}),
    },
    { actorId: actor.uid }
  );

  await audit.log({
    actor,
    action: isNew ? 'CREATE' : 'UPDATE',
    collection: COLLECTIONS.languages,
    documentId: code,
    summary: `${isNew ? 'Added' : 'Updated'} language ${data.name} (${code})`,
  });
}

/**
 * Removes a language.
 *
 * Refused while anyone is still using it: a profile pointing at a language that
 * no longer exists falls back silently, and the person loses their choice
 * without being told why. Disabling is the reversible option and is what the
 * screen suggests instead.
 */
export async function deleteLanguage(
  language: AppLanguage,
  actor: AppUser
): Promise<void> {
  const inUse = await countWhere(COLLECTIONS.users, [['language', '==', language.code]]);
  if (inUse > 0) {
    throw new AppError('language.inUse', 'failed-precondition');
  }

  await hardDelete(COLLECTIONS.languages, language.code);
  await audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.languages,
    documentId: language.code,
    summary: `Removed language ${language.name} (${language.code})`,
  });
}

/** True when the app bundles interface translations for this code. */
export function hasInterfaceTranslations(code: string): boolean {
  return Object.keys(resources).includes(code);
}
