import { useTranslation } from 'react-i18next';

import { useAsync } from './useAsync';
import { getSettings } from '@/services/settingsService';

/**
 * How this centre greets people.
 *
 * The admin's own wording when they set one, and the translated
 * "Assalamu Alaikum" when they have not — which is the case for almost
 * everybody, so the default has to be the good one rather than a placeholder
 * somebody is expected to replace.
 *
 * An admin who types a greeting is choosing one phrase for everyone. That is
 * their call to make and it is why the field exists, but it does mean a
 * hand-written greeting is not translated: the app cannot translate a sentence
 * it has never seen. Leaving it empty keeps all four languages.
 */
export function useGreeting(): string {
  const { t } = useTranslation();
  const { data: settings } = useAsync(() => getSettings(), []);
  return settings?.greeting?.trim() || t('app.greeting');
}
