import { AppError } from '@/utils/errors';
import type { LanguageCode } from '@/types';

/**
 * Machine-drafted translations, as a typing aid only.
 *
 * WHAT THIS IS FOR. Someone translating a fatwa question should not have to
 * type the whole thing from scratch. This fetches a rough rendering, drops it
 * into the editor, and leaves it there for a person to correct. It never saves,
 * never approves, and never reaches a reader on its own — the draft still goes
 * through the same admin review as anything typed by hand.
 *
 * WHY IT IS NOT OFFERED IN EVERY LANGUAGE. Measured on a plain fatwa question
 * ("ما حكم التثاؤب في الصلاة؟"):
 *
 *   ar → en  "What is the ruling on yawning in prayer?"        — correct
 *   ar → ta  "ஜெபத்தில் முளைத்தல் பற்றிய ஆட்சி என்ன?"          — reads as
 *            "what is the GOVERNANCE about SPROUTING", with a word for prayer
 *            from the wrong religious register. Wrong, and wrong in ways a
 *            non-Tamil-speaker reviewing it could not catch.
 *   ar → si  "[[United Nations geographical system for Asia]]" — unrelated text
 *
 * So English is offered plainly, Tamil is offered with a warning that it needs
 * rewriting rather than editing, and Sinhala is not offered at all: an engine
 * that returns unrelated sentences gives a translator nothing to work from and
 * everything to be misled by.
 */

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const TIMEOUT_MS = 20_000;

/** How far a machine draft can be trusted, per language. */
export type DraftQuality = 'usable' | 'poor' | 'unusable';

export function draftQualityFor(language: LanguageCode): DraftQuality {
  if (language === 'en') return 'usable';
  if (language === 'ta') return 'poor';
  // Sinhala, and anything an admin adds later that has not been checked.
  return 'unusable';
}

export function canDraft(language: LanguageCode): boolean {
  return draftQualityFor(language) !== 'unusable';
}

interface MyMemoryResponse {
  responseStatus?: number | string;
  responseData?: { translatedText?: string };
}

/**
 * Fetches a rough translation of `text` into `language`.
 *
 * The result is deliberately returned rather than stored: the caller puts it in
 * front of a person to edit. Nothing here writes to the database.
 */
export async function draftTranslation(
  text: string,
  language: LanguageCode
): Promise<string> {
  if (!canDraft(language)) {
    throw new AppError('translation.draftUnavailable', 'translate/unsupported');
  }

  const trimmed = text.trim();
  if (!trimmed) throw new AppError('translation.nothingToTranslate', 'translate/empty');

  // The free tier is metered by characters. A long fatwa question is well
  // within it, but truncating protects against a pathological record rather
  // than failing the whole request.
  const query = trimmed.slice(0, 900);

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&langpair=${encodeURIComponent(
      `ar|${language}`
    )}`;
    const response = await fetch(url, { signal: controller.signal });
    const payload = (await response.json()) as MyMemoryResponse;

    const result = payload.responseData?.translatedText?.trim();
    if (!result || Number(payload.responseStatus) !== 200) {
      throw new AppError('translation.draftFailed', 'translate/rejected');
    }

    // The service sometimes echoes an error inside the translation field rather
    // than in the status. Returning that verbatim would put "NO QUERY
    // SPECIFIED" into someone's translation box.
    if (/^[A-Z '"]+$/.test(result) && result.length < 60) {
      throw new AppError('translation.draftFailed', 'translate/echoed-error');
    }

    return result;
  } catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError('errors.networkUnavailable', 'translate/unreachable');
  } finally {
    clearTimeout(deadline);
  }
}
