import { useEffect, useState } from 'react';

import { useLanguage } from '@/contexts/LanguageContext';
import { cachedTranslation, translate, TranslationUnavailable } from '@/services/translateService';
import type { LanguageCode } from '@/types';

export interface AutoTranslation {
  /** What to show. The original until a translation arrives, then the translation. */
  text: string;
  /** True once the text on screen is machine output rather than what was written. */
  translated: boolean;
  busy: boolean;
  /** Why it could not be translated, for a screen that wants to say so. */
  error: string | null;
}

/**
 * Reads a passage in the reader's own language, translating it if need be.
 *
 * ORIGINAL FIRST, ALWAYS. The written text is shown immediately and replaced
 * only once a translation actually arrives. A reader never waits on a spinner
 * to see something that was already there, and a failed translation costs them
 * nothing — they simply read what the author wrote.
 *
 * THE CACHE IS WHY THIS CAN BE AUTOMATIC. Translation goes through a free
 * service with a daily allowance, and translating every article for every
 * reader on every open would exhaust it in an afternoon. Each passage is
 * translated once per language and stored, so the first reader pays for the
 * request and everybody after them gets it instantly and free. A cached
 * translation is used without any request at all, which is checked first.
 *
 * NOTHING HERE IS PRESENTED AS AN APPROVED TRANSLATION. The caller is handed
 * `translated` precisely so it can say, on screen, that software did this and
 * a person did not.
 */
export function useAutoTranslate(
  text: string | null | undefined,
  from: LanguageCode | undefined,
  options: { enabled?: boolean } = {}
): AutoTranslation {
  const { language } = useLanguage();
  const original = (text ?? '').trim();

  const [state, setState] = useState<AutoTranslation>({
    text: original,
    translated: false,
    busy: false,
    error: null,
  });

  useEffect(() => {
    const target = language as LanguageCode;
    const source = from ?? ('en' as LanguageCode);
    const enabled = options.enabled !== false;

    // Nothing to do: no text, already in the right language, or switched off.
    if (!enabled || !original || source === target) {
      setState({ text: original, translated: false, busy: false, error: null });
      return undefined;
    }

    let live = true;
    setState({ text: original, translated: false, busy: true, error: null });

    (async () => {
      // Free and instant when somebody has read this before.
      const hit = await cachedTranslation(original, source, target);
      if (!live) return;
      if (hit) {
        setState({ text: hit, translated: true, busy: false, error: null });
        return;
      }

      try {
        const result = await translate(original, source, target);
        if (live) setState({ text: result, translated: true, busy: false, error: null });
      } catch (err) {
        // The original stays on screen. A reader who cannot have a translation
        // is better served by the article than by an error where it was.
        const reason = err instanceof TranslationUnavailable ? err.reason : 'network';
        if (live) setState({ text: original, translated: false, busy: false, error: reason });
      }
    })();

    return () => {
      live = false;
    };
  }, [original, from, language, options.enabled]);

  return state;
}
