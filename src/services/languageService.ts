import { COLLECTIONS, LANGUAGES } from '@/constants/app';
import type { AppLanguage, AppUser } from '@/types';
import { listAll, setDocById, updateDocById } from './firestore';
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
